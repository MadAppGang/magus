use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader as TokioBufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, ChildStderr, Command};
use tokio::sync::{Mutex, oneshot};

use super::lifecycle::SidecarLifecycle;

pub struct SidecarManager {
    child: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    request_id: Arc<AtomicU64>,
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    lifecycle: Arc<SidecarLifecycle>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            request_id: Arc::new(AtomicU64::new(1)),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            lifecycle: Arc::new(SidecarLifecycle::new()),
        }
    }

    pub async fn start(&self, app_handle: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use super::lifecycle::SidecarState;

        self.lifecycle.set_state(SidecarState::Starting);

        // Get sidecar binary path - try multiple locations
        let target_triple = if cfg!(target_os = "macos") {
            format!("{}-apple-darwin", std::env::consts::ARCH)
        } else if cfg!(target_os = "windows") {
            format!("{}-pc-windows-msvc", std::env::consts::ARCH)
        } else {
            format!("{}-unknown-linux-gnu", std::env::consts::ARCH)
        };

        let sidecar_name_with_triple = format!("claudeup-sidecar-{}", target_triple);
        let sidecar_name_base = "claudeup-sidecar";

        // Try bundled app location first (MacOS folder, without target triple)
        let sidecar_path = std::env::current_exe()
            .ok()
            .and_then(|exe| {
                // Bundled app: Contents/MacOS/claudeup -> Contents/MacOS/claudeup-sidecar
                exe.parent().map(|p| p.join(sidecar_name_base))
            })
            .filter(|p| p.exists())
            // Try resource path (for dev mode with binaries in Resources)
            .or_else(|| {
                app_handle
                    .path()
                    .resolve(format!("binaries/{}", sidecar_name_with_triple), tauri::path::BaseDirectory::Resource)
                    .ok()
                    .filter(|p| p.exists())
            })
            // Try relative to executable (for dev mode)
            .or_else(|| {
                std::env::current_exe().ok().and_then(|exe| {
                    // In dev mode: target/debug/claudeup -> src-tauri/binaries/
                    exe.parent()? // target/debug
                        .parent()? // target
                        .parent()? // src-tauri
                        .join("binaries")
                        .join(&sidecar_name_with_triple)
                        .canonicalize()
                        .ok()
                })
            })
            // Try SIDECAR_PATH env var as last resort
            .or_else(|| std::env::var("SIDECAR_PATH").ok().map(std::path::PathBuf::from))
            .ok_or_else(|| format!("Could not find sidecar binary: {} or {}", sidecar_name_base, sidecar_name_with_triple))?;

        // Spawn sidecar process using tokio::process::Command
        let mut child = Command::new(&sidecar_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

        // Store stdin for RPC calls
        *self.stdin.lock().await = Some(stdin);

        // Spawn stdout reader task
        let pending_requests = Arc::clone(&self.pending_requests);
        let app_handle_clone = app_handle.clone();
        tokio::spawn(async move {
            Self::read_stdout(stdout, pending_requests, app_handle_clone).await;
        });

        // Wait for "SIDECAR_READY" on stderr, then continue draining stderr in background
        self.wait_for_ready_and_drain_stderr(stderr).await?;

        // Store child process after successful startup
        *self.child.lock().await = Some(child);

        self.lifecycle.set_state(SidecarState::Ready);

        Ok(())
    }

    async fn wait_for_ready_and_drain_stderr(&self, stderr: ChildStderr) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut reader = TokioBufReader::new(stderr).lines();

        // Retry with exponential backoff (max 10 attempts)
        for attempt in 0..10 {
            let backoff_ms = 500 * (1_u64 << attempt.min(5)); // Cap backoff at 16s
            tokio::time::sleep(Duration::from_millis(backoff_ms)).await;

            match tokio::time::timeout(Duration::from_secs(5), reader.next_line()).await {
                Ok(Ok(Some(line))) if line.contains("SIDECAR_READY") => {
                    println!("Sidecar ready after {} attempts", attempt + 1);

                    // Spawn background task to keep draining stderr (prevents sidecar from blocking)
                    tokio::spawn(async move {
                        loop {
                            match reader.next_line().await {
                                Ok(Some(line)) => {
                                    println!("Sidecar stderr: {}", line);
                                }
                                Ok(None) => {
                                    println!("Sidecar stderr closed");
                                    break;
                                }
                                Err(e) => {
                                    println!("Error reading sidecar stderr: {}", e);
                                    break;
                                }
                            }
                        }
                    });

                    return Ok(());
                }
                Ok(Ok(Some(line))) => {
                    println!("Sidecar stderr: {}", line);
                    continue;
                }
                Ok(Ok(None)) => {
                    return Err("Sidecar stderr closed unexpectedly".into());
                }
                Ok(Err(e)) => {
                    return Err(format!("Failed to read stderr: {}", e).into());
                }
                Err(_) => {
                    println!("Timeout waiting for SIDECAR_READY (attempt {})", attempt + 1);
                    continue;
                }
            }
        }

        Err("Sidecar failed to start after 10 retries".into())
    }

    async fn read_stdout(
        stdout: ChildStdout,
        pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
        app_handle: AppHandle,
    ) {
        println!("Sidecar stdout reader task started");
        // Use 2MB buffer to handle large JSON responses (plugin list can be 100KB+)
        let mut reader = TokioBufReader::with_capacity(2 * 1024 * 1024, stdout);
        // Pre-allocate buffer for reading lines - use Vec to accumulate bytes
        let mut line_buf: Vec<u8> = Vec::with_capacity(512 * 1024);

        println!("Waiting for sidecar stdout...");
        loop {
            line_buf.clear();

            // Use read_until to properly handle lines larger than pipe buffer (64KB on macOS)
            match tokio::time::timeout(
                Duration::from_secs(30), // Longer timeout for large responses
                reader.read_until(b'\n', &mut line_buf)
            ).await {
                Ok(Ok(0)) => {
                    println!("Sidecar stdout EOF");
                    break;
                }
                Ok(Ok(bytes_read)) => {
                    // Remove trailing newline if present
                    if line_buf.last() == Some(&b'\n') {
                        line_buf.pop();
                    }

                    // Convert to string
                    let line = match String::from_utf8(line_buf.clone()) {
                        Ok(s) => s,
                        Err(e) => {
                            println!("Invalid UTF-8 from sidecar: {}", e);
                            continue;
                        }
                    };

                    println!("Got line from sidecar (len={}, bytes_read={})", line.len(), bytes_read);

                    match serde_json::from_str::<Value>(&line) {
                        Ok(response) => {
                            // Check if it's a notification (no 'id')
                            if response.get("id").is_none() {
                                // Handle progress event
                                if let Some(method) = response.get("method").and_then(|m| m.as_str()) {
                                    if method == "progress" {
                                        let _ = app_handle.emit("sidecar-progress", response.get("params"));
                                    }
                                }
                            } else {
                                // Response with ID - match to pending request
                                if let Some(id) = response.get("id").and_then(|i| i.as_u64()) {
                                    let mut requests = pending_requests.lock().await;
                                    if let Some(tx) = requests.remove(&id) {
                                        let _ = tx.send(response);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            println!("Failed to parse sidecar output: error={}, line_len={}", e, line.len());
                            println!("First 200 chars: {}", line.chars().take(200).collect::<String>());
                            // Debug: show bytes around 64KB boundary
                            if line.len() > 65536 {
                                let start = 65530;
                                let end = std::cmp::min(65550, line.len());
                                println!("Bytes around 64KB ({}..{}): {:?}",
                                    start, end,
                                    &line.as_bytes()[start..end]);
                                println!("As string: {:?}", &line[start..end]);
                            }
                        }
                    }
                }
                Ok(Err(e)) => {
                    println!("Error reading sidecar stdout: {}", e);
                    break;
                }
                Err(_) => {
                    // Timeout is normal when sidecar is idle
                    continue;
                }
            }
        }
        println!("Sidecar stdout closed");
    }

    pub async fn call_rpc(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        // Generate unique request ID using atomic counter
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);

        // Create oneshot channel for response
        let (tx, rx) = oneshot::channel();
        self.pending_requests.lock().await.insert(id, tx);

        // Build request
        let request = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": id,
        });

        // Write to stdin with newline (scope the lock)
        {
            println!("Sending RPC request: method={}, id={}", method, id);
            let mut stdin_guard = self.stdin.lock().await;
            let stdin = stdin_guard.as_mut().ok_or("Sidecar stdin not available")?;
            let request_str = serde_json::to_string(&request).map_err(|e| e.to_string())?;
            println!("Request string length: {}", request_str.len());
            stdin.write_all(format!("{}\n", request_str).as_bytes()).await.map_err(|e| e.to_string())?;
            stdin.flush().await.map_err(|e| e.to_string())?;
            println!("Request sent and flushed");
        } // Lock released here

        // Method-specific timeouts
        let timeout = get_timeout_for_method(method);

        // Wait for response with timeout
        let response = match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                self.pending_requests.lock().await.remove(&id);
                return Err("RPC channel closed".to_string());
            }
            Err(_) => {
                // Clean up pending request on timeout to prevent memory leak
                self.pending_requests.lock().await.remove(&id);
                return Err(format!("RPC call timeout after {:?} for method: {}", timeout, method));
            }
        };

        // Check for error response
        if let Some(error) = response.get("error") {
            return Err(format!("RPC error: {}", error));
        }

        // Return result
        response
            .get("result")
            .cloned()
            .ok_or_else(|| "No result in RPC response".to_string())
    }

    pub async fn stop(&self) -> Result<(), String> {
        if let Some(mut child) = self.child.lock().await.take() {
            child.kill().await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn get_lifecycle(&self) -> Arc<SidecarLifecycle> {
        Arc::clone(&self.lifecycle)
    }
}

fn get_timeout_for_method(method: &str) -> Duration {
    match method {
        "plugin.install" | "plugin.refreshMarketplaces" => Duration::from_secs(300), // 5 minutes
        "mcp.add" | "tools.install" | "marketplace.add" => Duration::from_secs(180), // 3 minutes (clone can take time)
        _ => Duration::from_secs(60), // 1 minute default
    }
}

use std::sync::Arc;
use serde_json::{json, Value};
use tauri::State;

use crate::sidecar::SidecarManager;

// Project management commands
#[tauri::command]
pub async fn get_current_project() -> Result<Option<String>, String> {
    // TODO: Load from persistent storage
    Ok(None)
}

#[tauri::command]
pub async fn set_current_project(_path: String) -> Result<(), String> {
    // TODO: Save to persistent storage
    Ok(())
}

// Plugin commands
#[tauri::command]
pub async fn list_plugins(
    scope: Option<String>,
    project_path: Option<String>,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "scope": scope,
        "projectPath": project_path,
    });

    sidecar
        .call_rpc("plugin.list", params)
        .await
        }

#[tauri::command]
pub async fn install_plugin(
    name: String,
    scope: String,
    project_path: Option<String>,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "name": name,
        "scope": scope,
        "projectPath": project_path,
    });

    sidecar
        .call_rpc("plugin.install", params)
        .await
        }

#[tauri::command]
pub async fn update_plugin(
    name: String,
    scope: String,
    project_path: Option<String>,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "name": name,
        "scope": scope,
        "projectPath": project_path,
    });

    sidecar
        .call_rpc("plugin.update", params)
        .await
        }

#[tauri::command]
pub async fn uninstall_plugin(
    name: String,
    scope: String,
    project_path: Option<String>,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "name": name,
        "scope": scope,
        "projectPath": project_path,
    });

    sidecar
        .call_rpc("plugin.uninstall", params)
        .await
        }

#[tauri::command]
pub async fn enable_plugin(
    name: String,
    scope: String,
    project_path: Option<String>,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "name": name,
        "scope": scope,
        "projectPath": project_path,
    });

    sidecar
        .call_rpc("plugin.enable", params)
        .await
        }

#[tauri::command]
pub async fn disable_plugin(
    name: String,
    scope: String,
    project_path: Option<String>,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "name": name,
        "scope": scope,
        "projectPath": project_path,
    });

    sidecar
        .call_rpc("plugin.disable", params)
        .await
        }

#[tauri::command]
pub async fn refresh_marketplaces(
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    sidecar
        .call_rpc("plugin.refreshMarketplaces", json!({}))
        .await
        }

// Settings commands
#[tauri::command]
pub async fn get_settings(
    project_path: Option<String>,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "projectPath": project_path,
    });

    sidecar
        .call_rpc("settings.read", params)
        .await
        }

#[tauri::command]
pub async fn set_settings(
    settings: Value,
    project_path: Option<String>,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "settings": settings,
        "projectPath": project_path,
    });

    sidecar
        .call_rpc("settings.write", params)
        .await
        }

// Marketplace commands
#[tauri::command]
pub async fn list_marketplaces(
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    sidecar
        .call_rpc("marketplace.list", json!({}))
        .await
        }

#[tauri::command]
pub async fn add_marketplace(
    url: String,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "url": url,
    });

    sidecar
        .call_rpc("marketplace.add", params)
        .await
        }

#[tauri::command]
pub async fn remove_marketplace(
    name: String,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "name": name,
    });

    sidecar
        .call_rpc("marketplace.remove", params)
        .await
        }

#[tauri::command]
pub async fn fetch_plugin_details(
    name: String,
    source_url: String,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "name": name,
        "sourceUrl": source_url,
    });

    sidecar
        .call_rpc("plugin.fetchDetails", params)
        .await
        }

// MCP Server commands
#[tauri::command]
pub async fn list_mcp_servers(
    project_path: String,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "projectPath": project_path,
    });
    sidecar.call_rpc("mcp.list", params).await
}

#[tauri::command]
pub async fn add_mcp_server(
    name: String,
    config: Value,
    project_path: String,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "name": name,
        "config": config,
        "projectPath": project_path,
    });
    sidecar.call_rpc("mcp.add", params).await
}

#[tauri::command]
pub async fn remove_mcp_server(
    name: String,
    project_path: String,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "name": name,
        "projectPath": project_path,
    });
    sidecar.call_rpc("mcp.remove", params).await
}

#[tauri::command]
pub async fn toggle_mcp_server(
    name: String,
    enabled: bool,
    project_path: String,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "name": name,
        "enabled": enabled,
        "projectPath": project_path,
    });
    sidecar.call_rpc("mcp.toggle", params).await
}

#[tauri::command]
pub async fn test_mcp_connection(
    config: Value,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "config": config,
    });
    sidecar.call_rpc("mcp.testConnection", params).await
}

#[tauri::command]
pub async fn get_mcp_server_status(
    server_name: String,
    project_path: String,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "serverName": server_name,
        "projectPath": project_path,
    });
    sidecar.call_rpc("mcp.getStatus", params).await
}

#[tauri::command]
pub async fn get_mcp_env_vars(
    server_name: String,
    project_path: String,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "serverName": server_name,
        "projectPath": project_path,
    });
    sidecar.call_rpc("mcp.getEnvVars", params).await
}

#[tauri::command]
pub async fn set_mcp_env_var(
    server_name: String,
    key: String,
    value: String,
    project_path: String,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "serverName": server_name,
        "key": key,
        "value": value,
        "projectPath": project_path,
    });
    sidecar.call_rpc("mcp.setEnvVar", params).await
}

#[tauri::command]
pub async fn remove_mcp_env_var(
    server_name: String,
    key: String,
    project_path: String,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    let params = json!({
        "serverName": server_name,
        "key": key,
        "projectPath": project_path,
    });
    sidecar.call_rpc("mcp.removeEnvVar", params).await
}

#[tauri::command]
pub async fn get_curated_mcp_servers(
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<Value, String> {
    sidecar.call_rpc("mcp.getCurated", json!({})).await
}

#[tauri::command]
pub async fn search_mcp_registry(
    sidecar: State<'_, Arc<SidecarManager>>,
    query: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<Value, String> {
    sidecar.call_rpc("mcp.searchRegistry", json!({
        "query": query.unwrap_or_default(),
        "limit": limit.unwrap_or(20),
        "cursor": cursor,
    })).await
}

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

// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;
mod commands;

use std::sync::Arc;
use tauri::Manager;
use sidecar::SidecarManager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        // .plugin(tauri_plugin_updater::Builder::new().build()) // Disabled for dev
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Initialize sidecar manager
            let sidecar_manager = Arc::new(SidecarManager::new());
            app.manage(sidecar_manager.clone());

            // Start sidecar asynchronously (don't fail if sidecar is missing)
            tauri::async_runtime::spawn(async move {
                match sidecar_manager.start(app_handle.clone()).await {
                    Ok(_) => {
                        println!("Sidecar started successfully");
                    }
                    Err(e) => {
                        println!("Warning: Failed to start sidecar: {}", e);
                        println!("The app will run in demo mode without backend functionality.");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_current_project,
            commands::set_current_project,
            commands::list_plugins,
            commands::install_plugin,
            commands::update_plugin,
            commands::uninstall_plugin,
            commands::enable_plugin,
            commands::disable_plugin,
            commands::refresh_marketplaces,
            commands::fetch_plugin_details,
            commands::get_settings,
            commands::set_settings,
            // Marketplace commands
            commands::list_marketplaces,
            commands::add_marketplace,
            commands::remove_marketplace,
            // MCP Server commands
            commands::list_mcp_servers,
            commands::add_mcp_server,
            commands::remove_mcp_server,
            commands::toggle_mcp_server,
            commands::test_mcp_connection,
            commands::get_mcp_server_status,
            commands::get_mcp_env_vars,
            commands::set_mcp_env_var,
            commands::remove_mcp_env_var,
            commands::get_curated_mcp_servers,
            commands::search_mcp_registry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

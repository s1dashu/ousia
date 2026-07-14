mod commands;
mod logging;
mod paths;
mod rpc;
mod runtime;
mod state;
mod window_chrome;

use commands::*;
use logging::RuntimeLogger;
use paths::ShellEnvironment;
use rpc::PiHost;
use runtime::PiRuntimeManager;
use state::SessionStore;
use tauri::Manager;
use window_chrome::{
    WindowChrome, get_window_zoom_state, set_window_zoom, sync_window_traffic_lights,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let result = (|| -> Result<(), String> {
                let window = app
                    .get_webview_window("main")
                    .ok_or_else(|| "The main window is unavailable.".to_string())?;
                window
                    .show()
                    .map_err(|error| format!("Failed to show the existing Pi window: {error}"))?;
                window.unminimize().map_err(|error| {
                    format!("Failed to unminimize the existing Pi window: {error}")
                })?;
                window
                    .set_focus()
                    .map_err(|error| format!("Failed to focus the existing Pi window: {error}"))
            })();
            if let Some(host) = app.try_state::<PiHost>() {
                match result {
                    Ok(()) => host.logger().record(
                        "info",
                        "app.single_instance",
                        "Focused the existing Pi instance after a duplicate launch",
                        Some(serde_json::json!({
                            "argumentCount": args.len(),
                            "launchDirectory": cwd,
                        })),
                    ),
                    Err(error) => host.logger().record(
                        "error",
                        "app.single_instance",
                        "Failed to focus the existing Pi instance after a duplicate launch",
                        Some(serde_json::json!({
                            "argumentCount": args.len(),
                            "error": error,
                            "launchDirectory": cwd,
                        })),
                    ),
                }
            } else if let Err(error) = result {
                eprintln!("{error}");
            }
        }));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let logger = RuntimeLogger::initialize(app.handle())?;
            let environment = ShellEnvironment::load(&logger)?;
            let runtime = PiRuntimeManager::initialize(app.handle(), logger.clone())?;
            let session_store = SessionStore::initialize(app.handle(), logger.clone())?;
            let host = PiHost::new(
                app.handle().clone(),
                environment,
                logger.clone(),
                runtime,
                session_store,
            );
            logger.record(
                "info",
                "app",
                "Pi Tauri host initialized",
                Some(serde_json::json!({ "logPath": logger.path() })),
            );
            app.manage(host);
            let window_chrome = WindowChrome::new(logger.clone());
            let main_window = app
                .get_webview_window("main")
                .ok_or_else(|| "Main WebView window was not created".to_string())?;
            window_chrome.initialize();
            app.manage(window_chrome);
            let event_window = main_window.clone();
            main_window.on_window_event(move |event| {
                let state = event_window.state::<WindowChrome>();
                state.handle_window_event(&event_window, event);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_state,
            save_app_state,
            report_frontend_error,
            report_frontend_log,
            prepare_chat_session,
            send_chat_message,
            generate_chat_title,
            get_chat_history,
            get_chat_tool_payload,
            branch_chat,
            move_chat_session,
            get_chat_context_usage,
            export_chat,
            interrupt_chat,
            clear_chat_queue,
            compact_chat,
            list_models,
            check_pi_environment,
            select_pi_binary,
            install_pi_runtime,
            uninstall_pi_runtime,
            add_pi_to_shell_path,
            remove_pi_from_shell_path,
            save_pi_retry_settings,
            open_directory_in_finder,
            show_file_in_finder,
            release_pi_sessions,
            delete_pi_sessions,
            get_window_zoom_state,
            set_window_zoom,
            sync_window_traffic_lights,
        ])
        .build(tauri::generate_context!())
        .expect("fatal error while building Pi");
    app.run(|app_handle, event| {
        if !matches!(event, tauri::RunEvent::Exit) {
            return;
        }
        let host = app_handle.state::<PiHost>().inner().clone();
        let logger = host.logger().clone();
        if let Err(error) = tauri::async_runtime::block_on(host.release_all()) {
            logger.record(
                "error",
                "pi.process",
                "Failed to stop all Pi RPC processes while exiting",
                Some(serde_json::json!({ "error": error })),
            );
        } else {
            logger.record(
                "info",
                "pi.process",
                "Stopped all Pi RPC processes while exiting",
                None,
            );
        }
    });
}

mod mqtt_engine;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn bridge_add_printer(
    config: mqtt_engine::PrinterConfig,
    app: tauri::AppHandle,
) -> Result<(), String> {
    mqtt_engine::add_printer(config, app).await
}

#[tauri::command]
async fn bridge_remove_printer(printer_id: String) -> Result<(), String> {
    mqtt_engine::remove_printer(&printer_id).await
}

#[tauri::command]
async fn bridge_publish_command(
    printer_id: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    mqtt_engine::publish_command(&printer_id, payload).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            bridge_add_printer,
            bridge_remove_printer,
            bridge_publish_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

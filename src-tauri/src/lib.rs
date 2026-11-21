mod windowing;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(windowing::setup)
        .invoke_handler(tauri::generate_handler![
            windowing::open_window,
            windowing::configure_main_window
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OI-table");
}

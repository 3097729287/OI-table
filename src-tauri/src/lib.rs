mod settings;
mod storage;
mod triggers;
mod windowing;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        windowing::focus_main_window(app);
    }));

    builder
        .setup(|app| {
            storage::setup(app)?;
            windowing::setup(app)
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::update_settings,
            triggers::get_trigger,
            triggers::increment_trigger,
            windowing::open_window,
            windowing::configure_main_window
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OI-table");
}

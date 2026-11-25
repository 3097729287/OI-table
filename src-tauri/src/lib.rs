mod editor_check;
mod editor_run;
mod logging;
mod problem_library;
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
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_dialog::init());

    builder
        .setup(|app| {
            storage::setup(app)?;
            let log_limit = settings::startup_log_limit(app);
            if let Err(error) = logging::setup(
                app,
                log_limit
                    .as_ref()
                    .copied()
                    .unwrap_or(settings::DEFAULT_LOG_MAX_SIZE_MIB),
            ) {
                eprintln!("Could not initialize local logs: {error}");
            }
            if let Err(error) = log_limit {
                log::warn!(
                    "Could not read the saved log size limit ({:?})",
                    error.kind()
                );
            }
            windowing::setup(app)
                .inspect_err(|error| log::error!("Could not open the main window: {error}"))?;
            log::info!("Application started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::update_settings,
            editor_check::check_editor_code,
            editor_run::run_editor_code,
            triggers::get_trigger,
            triggers::increment_trigger,
            problem_library::pick_problem_library_source,
            problem_library::import_problem_libraries_from_path,
            problem_library::list_problem_libraries,
            problem_library::set_problem_library_enabled,
            problem_library::uninstall_problem_library,
            problem_library::list_library_problems,
            problem_library::get_library_problem,
            problem_library::list_problem_submissions,
            problem_library::list_library_archive_children,
            problem_library::list_library_tag_groups,
            windowing::open_window,
            windowing::configure_main_window
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OI-table");
}

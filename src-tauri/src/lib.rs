use tauri::Manager;

mod editor_debug;
mod editor_run;
mod logging;
mod problem_drafts;
mod problem_library;
mod run_debug_diagnostics;
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
        .manage(editor_debug::EditorDebugState::default())
        .setup(|app| {
            storage::setup(app)?;
            problem_drafts::setup(app)?;
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
            editor_run::run_editor_code,
            editor_debug::debug_start,
            editor_debug::debug_step,
            editor_debug::debug_inspect,
            editor_debug::debug_variables,
            editor_debug::debug_stop,
            run_debug_diagnostics::check_run_debug_environment,
            problem_drafts::get_problem_draft,
            problem_drafts::save_problem_draft,
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
        .build(tauri::generate_context!())
        .expect("failed to build OI-table")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<editor_debug::EditorDebugState>().cancel_all();
            }
        });
}

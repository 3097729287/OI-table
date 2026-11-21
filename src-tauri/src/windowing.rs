use tauri::{
    ipc::CapabilityBuilder, App, AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

const CHILD_PREFIX: &str = "child-";
const DEFAULT_SIZE: [f64; 2] = [920.0, 620.0];
const DEFAULT_MIN_SIZE: [f64; 2] = [360.0, 400.0];

fn window_dimensions(
    size: Option<[f64; 2]>,
    min_size: Option<[f64; 2]>,
) -> Result<([f64; 2], [f64; 2]), &'static str> {
    let size = size.unwrap_or(DEFAULT_SIZE);
    let min_size = min_size.unwrap_or(DEFAULT_MIN_SIZE);
    if size.into_iter().zip(min_size).any(|(initial, minimum)| {
        !initial.is_finite() || !minimum.is_finite() || minimum <= 0.0 || initial < minimum
    }) {
        return Err("Invalid window dimensions");
    }
    Ok((size, min_size))
}

fn build_window(
    app: &AppHandle,
    label: &str,
    title: &str,
    size: [f64; 2],
    min_size: [f64; 2],
) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .decorations(false)
        .inner_size(size[0], size[1])
        .min_inner_size(min_size[0], min_size[1])
        .center()
        .build()
}

#[tauri::command]
pub async fn open_window(
    app: AppHandle,
    route: String,
    title: String,
    size: Option<[f64; 2]>,
    min_size: Option<[f64; 2]>,
) -> Result<(), String> {
    if route.is_empty()
        || !route
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("Invalid child window route".into());
    }

    let (size, min_size) = window_dimensions(size, min_size)?;
    let label = format!("{CHILD_PREFIX}{route}");
    if let Some(window) = app.get_webview_window(&label) {
        return focus_window(&window).map_err(|error| error.to_string());
    }

    match build_window(&app, &label, &title, size, min_size) {
        Ok(_) => Ok(()),
        // A concurrent request may have opened the same route.
        Err(error) => match app.get_webview_window(&label) {
            Some(window) => focus_window(&window).map_err(|error| error.to_string()),
            None => Err(error.to_string()),
        },
    }
}

#[tauri::command]
pub async fn configure_main_window(
    window: WebviewWindow,
    title: String,
    size: Option<[f64; 2]>,
    min_size: Option<[f64; 2]>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can apply startup options".into());
    }

    let use_custom_dimensions = size.is_some() || min_size.is_some();
    let (size, min_size) = window_dimensions(size, min_size)?;
    window
        .set_title(&title)
        .map_err(|error| error.to_string())?;
    if use_custom_dimensions {
        window
            .set_min_size(Some(LogicalSize::new(min_size[0], min_size[1])))
            .and_then(|()| window.set_size(LogicalSize::new(size[0], size[1])))
            .and_then(|()| window.center())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn focus_window(window: &WebviewWindow) -> tauri::Result<()> {
    window.unminimize()?;
    window.show()?;
    window.set_focus()
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    app.add_capability(
        CapabilityBuilder::new("app-windows")
            .window("main")
            .window(format!("{CHILD_PREFIX}*"))
            .permission("core:event:allow-listen")
            .permission("core:event:allow-unlisten")
            .permission("core:event:allow-emit")
            .permission("core:window:allow-start-dragging")
            .permission("core:window:allow-internal-toggle-maximize")
            .permission("core:window:allow-is-maximized")
            .permission("core:window:allow-minimize")
            .permission("core:window:allow-toggle-maximize")
            .permission("core:window:allow-close"),
    )?;
    let main_window = build_window(
        app.handle(),
        "main",
        app.config().product_name.as_deref().unwrap_or("OI-table"),
        DEFAULT_SIZE,
        DEFAULT_MIN_SIZE,
    )?;
    let app_handle = app.handle().clone();
    main_window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            app_handle.exit(0);
        }
    });
    Ok(())
}

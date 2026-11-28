pub(crate) fn valid_binding(binding: &str) -> bool {
    let mut parts = binding.split('+');
    let key = parts.next_back().unwrap_or_default();
    let mut last_modifier = 0;
    let mut has_modifier = false;
    for part in parts {
        let modifier = match part {
            "Ctrl" => 1,
            "Alt" => 2,
            "Shift" => 3,
            "Meta" => 4,
            _ => return false,
        };
        if modifier <= last_modifier {
            return false;
        }
        last_modifier = modifier;
        has_modifier |= part != "Shift";
    }

    let function_key = key.strip_prefix('F').is_some_and(|number| {
        !number.starts_with('0')
            && number.bytes().all(|byte| byte.is_ascii_digit())
            && number
                .parse::<u8>()
                .is_ok_and(|value| (1..=24).contains(&value))
    });
    function_key
        || has_modifier
            && (matches!(key.as_bytes(), [b'A'..=b'Z' | b'0'..=b'9'])
                || matches!(
                    key,
                    "Backspace"
                        | "Tab"
                        | "Enter"
                        | "Escape"
                        | "Space"
                        | "PageUp"
                        | "PageDown"
                        | "End"
                        | "Home"
                        | "ArrowLeft"
                        | "ArrowUp"
                        | "ArrowRight"
                        | "ArrowDown"
                        | "Insert"
                        | "Delete"
                        | "Semicolon"
                        | "Equal"
                        | "Comma"
                        | "Minus"
                        | "Period"
                        | "Slash"
                        | "Backquote"
                        | "BracketLeft"
                        | "Backslash"
                        | "BracketRight"
                        | "Quote"
                ))
}

#[cfg(windows)]
pub(crate) fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use webview2_com::{
        AcceleratorKeyPressedEventHandler,
        Microsoft::Web::WebView2::Win32::ICoreWebView2AcceleratorKeyPressedEventArgs2,
    };
    use windows::core::Interface;

    window.with_webview(|webview| {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                if let Ok(args) = args.cast::<ICoreWebView2AcceleratorKeyPressedEventArgs2>() {
                    // Skip browser actions and let the key reach the application's dispatcher.
                    unsafe { args.SetIsBrowserAcceleratorKeyEnabled(false)? };
                }
            }
            Ok(())
        }));
        let mut token = 0;
        if let Err(error) = unsafe {
            webview
                .controller()
                .add_AcceleratorKeyPressed(&handler, &mut token)
        } {
            log::warn!("Could not register WebView shortcut handling: {error}");
        }
    })
}

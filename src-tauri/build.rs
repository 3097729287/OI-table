use std::{env, fs, io, path::PathBuf};

fn main() -> io::Result<()> {
    let catalogs = "../src/i18n/locales";
    println!("cargo:rerun-if-changed={catalogs}");

    let mut locales = Vec::new();
    for entry in fs::read_dir(catalogs)? {
        let entry = entry?;
        let filename = entry.file_name();
        let Some(locale) = filename
            .to_str()
            .and_then(|name| name.strip_suffix(".json"))
        else {
            continue;
        };
        if entry.file_type()?.is_file() {
            locales.push(locale.to_owned());
        }
    }
    locales.sort_unstable();

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo should set OUT_DIR"));
    fs::write(out_dir.join("ui-locales.txt"), locales.join("\n"))?;
    tauri_build::build();
    Ok(())
}

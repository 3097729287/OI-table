use std::{
    env,
    fs::{self, File},
    io::{self, BufRead, BufReader, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use chrono::Local;
use log::{LevelFilter, Log, Metadata, Record};
use rolling_file::{BasicRollingFileAppender, RollingConditionBasic};
use tauri::{App, Manager};

const MIB: u64 = 1024 * 1024;
const APP_TARGET: &str = "oi_table_lib";
static FILES: Mutex<Option<LogFiles>> = Mutex::new(None);

struct LogFiles {
    directory: PathBuf,
    max_bytes: u64,
    writer: Option<BasicRollingFileAppender>,
}

impl LogFiles {
    fn set_limit(&mut self, max_bytes: u64) -> io::Result<()> {
        self.max_bytes = max_bytes;
        self.writer = None;
        for name in ["oi-table.log", "oi-table.log.1"] {
            let path = self.directory.join(name);
            trim_log(&path, max_bytes, &self.directory)?;
        }
        Ok(())
    }

    fn append(&mut self, line: &str) -> io::Result<()> {
        let path = self.directory.join("oi-table.log");
        let size = match fs::metadata(&path) {
            Ok(metadata) => metadata.len(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => 0,
            Err(error) => return Err(error),
        };
        if size > self.max_bytes {
            self.writer = None;
            trim_log(&path, self.max_bytes, &self.directory)?;
        }
        let writer = match self.writer.as_mut() {
            Some(writer) => writer,
            None => self.writer.insert(BasicRollingFileAppender::new(
                path,
                RollingConditionBasic::new(),
                1,
            )?),
        };
        if size > 0 && size.saturating_add(line.len() as u64) > self.max_bytes {
            writer.rollover()?;
        }
        writer.write_all(line.as_bytes())?;
        writer.flush()
    }
}

fn trim_log(path: &Path, max_bytes: u64, directory: &Path) -> io::Result<()> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let size = file.metadata()?.len();
    if size <= max_bytes {
        return Ok(());
    }

    // Start one byte early so a complete line on the retention boundary survives.
    file.seek(SeekFrom::Start(size - max_bytes - 1))?;
    let mut tail = BufReader::new(file);
    tail.skip_until(b'\n')?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    io::copy(&mut tail, &mut temporary)?;
    drop(tail);
    temporary.persist(path)?;
    Ok(())
}

struct FileLogger {
    filter: env_filter::Filter,
}

impl FileLogger {
    fn from_filter(filter: &str) -> Self {
        let mut builder = env_filter::Builder::new();
        builder.filter_level(LevelFilter::Info).parse(filter);
        Self {
            filter: builder.build(),
        }
    }
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.target().split("::").next() == Some(APP_TARGET) && self.filter.enabled(metadata)
    }

    fn log(&self, record: &Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let message = record.args().to_string().replace(['\r', '\n'], " ");
        let mut line = format!(
            "[{timestamp}] [{:<5}] [{}] {message}",
            record.level().as_str(),
            record.target()
        );
        let Ok(mut files) = FILES.lock() else {
            return;
        };
        if let Some(files) = files.as_mut() {
            let mut end = line.len().min((files.max_bytes - 1) as usize);
            while !line.is_char_boundary(end) {
                end -= 1;
            }
            line.truncate(end);
            line.push('\n');
            if let Err(error) = files.append(&line) {
                eprintln!("Could not write local log: {error}");
            }
        }
    }

    fn flush(&self) {}
}

pub fn setup(app: &App, max_size_mib: u32) -> Result<(), Box<dyn std::error::Error>> {
    let directory = app.path().app_log_dir()?;
    fs::create_dir_all(&directory)?;
    let mut files = LogFiles {
        directory,
        max_bytes: u64::from(max_size_mib) * MIB,
        writer: None,
    };
    files.set_limit(files.max_bytes)?;
    {
        let mut shared = FILES
            .lock()
            .map_err(|_| io::Error::other("Log store lock is poisoned"))?;
        *shared = Some(files);
    }
    let logger = FileLogger::from_filter(&env::var("RUST_LOG").unwrap_or_default());
    let max_level = logger.filter.filter();
    log::set_boxed_logger(Box::new(logger))?;
    log::set_max_level(max_level);
    Ok(())
}

pub fn set_max_size_mib(size: u32) -> io::Result<()> {
    let mut files = FILES
        .lock()
        .map_err(|_| io::Error::other("Log store lock is poisoned"))?;
    if let Some(files) = files.as_mut() {
        files.set_limit(u64::from(size) * MIB)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use log::Level;

    #[test]
    fn rotates_one_backup_and_preserves_recent_complete_lines_on_size_reduction() -> io::Result<()>
    {
        let directory = tempfile::tempdir()?;
        let mut files = LogFiles {
            directory: directory.path().to_owned(),
            max_bytes: 12,
            writer: None,
        };
        files.append("abc\ndef\n")?;
        files.append("ghi\njkl\n")?;
        files.append("mno\npqr\n")?;
        let current = directory.path().join("oi-table.log");
        let backup = directory.path().join("oi-table.log.1");
        assert_eq!(fs::read_to_string(&backup)?, "ghi\njkl\n");
        files.set_limit(4)?;
        assert_eq!(fs::read_to_string(&current)?, "pqr\n");
        assert_eq!(fs::read_to_string(&backup)?, "jkl\n");
        Ok(())
    }

    #[test]
    fn defaults_to_info_and_honors_the_most_specific_app_rule() {
        let metadata = |level, target| Metadata::builder().level(level).target(target).build();
        let default = FileLogger::from_filter("");
        assert!(default.enabled(&metadata(Level::Info, "oi_table_lib::windowing")));
        assert!(!default.enabled(&metadata(Level::Debug, "oi_table_lib::windowing")));

        let logger =
            FileLogger::from_filter("debug,oi_table_lib=info,oi_table_lib::settings=trace");
        assert!(logger.enabled(&metadata(Level::Trace, "oi_table_lib::settings")));
        assert!(!logger.enabled(&metadata(Level::Debug, "oi_table_lib::windowing")));
        assert!(!logger.enabled(&metadata(Level::Error, "dependency")));
    }
}

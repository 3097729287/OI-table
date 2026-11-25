use std::{
    env, fs,
    io::{self, Read, Seek, Write},
    mem,
    path::Path,
    process::{Command, ExitStatus, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;

use crate::editor_check::{find_cpp, find_python, hidden_command, stop_child, EditorLanguage};

const MAX_SOURCE_BYTES: usize = 256 * 1024;
const MAX_INPUT_BYTES: usize = 256 * 1024;
const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const COMPILE_TIMEOUT: Duration = Duration::from_secs(15);
const RUN_TIMEOUT: Duration = Duration::from_secs(5);
static RUNNING: Mutex<()> = Mutex::new(());

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum RunStatus {
    Success,
    CompileError,
    RuntimeError,
    CompileTimeout,
    RuntimeTimeout,
    OutputLimit,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunResult {
    status: RunStatus,
    stdout: String,
    stderr: String,
    duration_ms: u64,
    exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
pub(crate) struct RunError {
    code: &'static str,
    message: String,
}

impl RunError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl From<io::Error> for RunError {
    fn from(error: io::Error) -> Self {
        Self::new("run_failed", error.to_string())
    }
}

type Result<T> = std::result::Result<T, RunError>;

#[tauri::command]
pub(crate) async fn run_editor_code(
    language: EditorLanguage,
    source: String,
    input: String,
) -> Result<RunResult> {
    if !cfg!(desktop) {
        return Err(RunError::new(
            "tool_unavailable",
            "Running a draft is available on desktop",
        ));
    }
    validate_sizes(&source, &input)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _running = RUNNING
            .try_lock()
            .map_err(|_| RunError::new("run_busy", "Another draft is already running"))?;
        run_draft(language, &source, &input)
    })
    .await
    .map_err(|error| RunError::new("run_failed", error.to_string()))?
}

fn validate_sizes(source: &str, input: &str) -> Result<()> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(RunError::new(
            "source_too_large",
            "Local runs accept up to 256 KiB of source",
        ));
    }
    if input.len() > MAX_INPUT_BYTES {
        return Err(RunError::new(
            "input_too_large",
            "Local runs accept up to 256 KiB of input",
        ));
    }
    Ok(())
}

fn run_draft(language: EditorLanguage, source: &str, input: &str) -> Result<RunResult> {
    let started = Instant::now();
    let directory = tempfile::tempdir()?;
    let root = directory.path();
    let (mut compile, execute) = match language {
        EditorLanguage::Cpp => {
            let (name, compiler) = find_cpp().ok_or_else(|| {
                RunError::new(
                    "tool_unavailable",
                    "No C++ compiler found. Install g++ or clang++ on PATH.",
                )
            })?;
            fs::write(root.join("solution.cpp"), source)?;
            let binary = format!("solution{}", env::consts::EXE_SUFFIX);
            let mut compile = hidden_command(&compiler);
            compile.args(["-std=gnu++17", "-O2", "solution.cpp", "-o", &binary]);
            compile.arg(if name == "g++" {
                "-fdiagnostics-color=never"
            } else {
                "-fno-color-diagnostics"
            });
            (compile, hidden_command(&root.join(binary)))
        }
        EditorLanguage::Python => {
            let python = find_python().ok_or_else(|| {
                RunError::new(
                    "tool_unavailable",
                    "No Python interpreter found. Install Python 3 on PATH.",
                )
            })?;
            fs::write(root.join("solution.py"), source)?;
            let mut compile = hidden_command(&python);
            compile.args([
                "-I",
                "-B",
                "-X",
                "utf8",
                "-c",
                "compile(open('solution.py', 'rb').read(), 'solution.py', 'exec')",
            ]);
            let mut execute = hidden_command(&python);
            execute.args(["-I", "-B", "-u", "-X", "utf8", "solution.py"]);
            (compile, execute)
        }
    };

    compile.env("LC_ALL", "C");
    let compiled = run_process(compile, root, "", COMPILE_TIMEOUT)?;
    if !matches!(compiled.finish, ProcessFinish::Exited(status) if status.success()) {
        return Ok(compiled.result(true, started));
    }
    Ok(run_process(execute, root, input, RUN_TIMEOUT)?.result(false, started))
}

#[derive(Clone, Copy)]
enum ProcessFinish {
    Exited(ExitStatus),
    TimedOut,
    OutputLimit,
}

struct ProcessOutput {
    finish: ProcessFinish,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl ProcessOutput {
    fn result(self, compiling: bool, started: Instant) -> RunResult {
        let (status, exit_code) = match self.finish {
            ProcessFinish::Exited(code) if code.success() => (RunStatus::Success, code.code()),
            ProcessFinish::Exited(code) => {
                let status = if compiling {
                    RunStatus::CompileError
                } else {
                    RunStatus::RuntimeError
                };
                (status, code.code())
            }
            ProcessFinish::TimedOut => {
                let status = if compiling {
                    RunStatus::CompileTimeout
                } else {
                    RunStatus::RuntimeTimeout
                };
                (status, None)
            }
            ProcessFinish::OutputLimit => (RunStatus::OutputLimit, None),
        };
        RunResult {
            status,
            stdout: String::from_utf8_lossy(&self.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&self.stderr).into_owned(),
            duration_ms: started.elapsed().as_millis() as u64,
            exit_code,
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum CaptureStatus {
    Reading,
    Finished,
    Limited,
    Failed,
}

struct CaptureData {
    bytes: Vec<u8>,
    status: CaptureStatus,
}

struct Capture(Arc<Mutex<CaptureData>>);

impl Capture {
    fn start(mut reader: impl Read + Send + 'static) -> Self {
        let data = Arc::new(Mutex::new(CaptureData {
            bytes: Vec::new(),
            status: CaptureStatus::Reading,
        }));
        let shared = Arc::clone(&data);
        thread::spawn(move || {
            let mut buffer = [0; 8192];
            loop {
                let result = reader.read(&mut buffer);
                let mut data = shared.lock().expect("capture lock");
                match result {
                    Ok(0) => data.status = CaptureStatus::Finished,
                    Ok(read) => {
                        let retained = read.min(MAX_OUTPUT_BYTES - data.bytes.len());
                        data.bytes.extend_from_slice(&buffer[..retained]);
                        if retained == read {
                            continue;
                        }
                        data.status = CaptureStatus::Limited;
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(_) => data.status = CaptureStatus::Failed,
                }
                break;
            }
        });
        Self(data)
    }

    fn status(&self) -> CaptureStatus {
        self.0.lock().expect("capture lock").status
    }

    fn output(&self) -> Vec<u8> {
        mem::take(&mut self.0.lock().expect("capture lock").bytes)
    }
}

fn run_process(
    mut command: Command,
    directory: &Path,
    input: &str,
    timeout: Duration,
) -> io::Result<ProcessOutput> {
    let stdin = if input.is_empty() {
        Stdio::null()
    } else {
        let mut file = tempfile::tempfile()?;
        file.write_all(input.as_bytes())?;
        file.rewind()?;
        Stdio::from(file)
    };
    let mut child = command
        .current_dir(directory)
        .stdin(stdin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    #[cfg(windows)]
    let job = windows_job::Job::attach(&child);
    let stdout = Capture::start(child.stdout.take().expect("stdout is piped"));
    let stderr = Capture::start(child.stderr.take().expect("stderr is piped"));

    let deadline = Instant::now() + timeout;
    let limited =
        || stdout.status() == CaptureStatus::Limited || stderr.status() == CaptureStatus::Limited;
    let reading =
        || stdout.status() == CaptureStatus::Reading || stderr.status() == CaptureStatus::Reading;
    let mut finish = loop {
        if limited() {
            break ProcessFinish::OutputLimit;
        }
        match child.try_wait() {
            Ok(Some(status)) => break ProcessFinish::Exited(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => break ProcessFinish::TimedOut,
            Err(error) => {
                stop_child(&mut child);
                return Err(error);
            }
        }
    };

    if !matches!(finish, ProcessFinish::Exited(_)) {
        stop_child(&mut child);
    }
    #[cfg(windows)]
    drop(job);
    #[cfg(unix)]
    if matches!(finish, ProcessFinish::Exited(_)) && reading() {
        crate::editor_check::stop_process_group(child.id());
    }

    // Do not let an inherited output pipe block returning a completed run.
    let drain_deadline = Instant::now() + Duration::from_millis(200);
    while reading() && Instant::now() < drain_deadline {
        thread::sleep(Duration::from_millis(5));
    }
    if limited() {
        finish = ProcessFinish::OutputLimit;
    }
    if matches!(finish, ProcessFinish::Exited(_))
        && [stdout.status(), stderr.status()].contains(&CaptureStatus::Failed)
    {
        return Err(io::Error::other("Could not read the draft's output"));
    }
    Ok(ProcessOutput {
        finish,
        stdout: stdout.output(),
        stderr: stderr.output(),
    })
}

#[cfg(windows)]
mod windows_job {
    use std::{
        ffi::c_void,
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle},
        process::Child,
        ptr,
    };

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> RawHandle;
        fn AssignProcessToJobObject(job: RawHandle, process: RawHandle) -> i32;
        fn TerminateJobObject(job: RawHandle, exit_code: u32) -> i32;
    }

    pub(super) struct Job(OwnedHandle);

    impl Job {
        pub(super) fn attach(child: &Child) -> Option<Self> {
            // Null arguments create an unnamed job with default security attributes.
            let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
            if handle.is_null() {
                return None;
            }
            // A non-null result is a new owned handle. Both handles remain live for assignment.
            let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
            let assigned =
                unsafe { AssignProcessToJobObject(handle.as_raw_handle(), child.as_raw_handle()) };
            (assigned != 0).then_some(Self(handle))
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // Buffered output is collected after related processes are stopped.
            unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_source_and_input_by_utf8_bytes() {
        assert!(
            validate_sizes(&"a".repeat(MAX_SOURCE_BYTES), &"b".repeat(MAX_INPUT_BYTES)).is_ok()
        );
        assert_eq!(
            validate_sizes(&"界".repeat(MAX_SOURCE_BYTES / 3 + 1), "")
                .unwrap_err()
                .code,
            "source_too_large"
        );
        assert_eq!(
            validate_sizes("", &"b".repeat(MAX_INPUT_BYTES + 1))
                .unwrap_err()
                .code,
            "input_too_large"
        );
    }

    #[cfg(desktop)]
    #[test]
    #[ignore = "requires local C++ and Python tools"]
    fn runs_cpp_and_python_and_reports_stage_failures() {
        let cpp = run_draft(
            EditorLanguage::Cpp,
            "#include <iostream>\nint main() { int x; std::cin >> x; std::cout << x * 2; }",
            "21\n",
        )
        .unwrap();
        assert_eq!(
            (cpp.status, cpp.stdout.as_str(), cpp.exit_code),
            (RunStatus::Success, "42", Some(0))
        );
        let invalid_cpp = run_draft(EditorLanguage::Cpp, "int main() { missing; }", "").unwrap();
        assert_eq!(invalid_cpp.status, RunStatus::CompileError);
        assert!(invalid_cpp.stderr.contains("missing"));

        let python = run_draft(EditorLanguage::Python, "print(input())", "界😀\n").unwrap();
        assert_eq!(python.status, RunStatus::Success);
        assert_eq!(python.stdout.trim_end(), "界😀");
        let invalid_python = run_draft(EditorLanguage::Python, "if True print(42)", "").unwrap();
        assert_eq!(invalid_python.status, RunStatus::CompileError);
        assert!(invalid_python.stderr.contains("SyntaxError"));
        let failed = run_draft(
            EditorLanguage::Python,
            "print('before')\nraise ValueError('failed')",
            "",
        )
        .unwrap();
        assert_eq!(failed.status, RunStatus::RuntimeError);
        assert_eq!(failed.stdout.trim_end(), "before");
        assert!(failed.stderr.contains("ValueError: failed"));
    }

    #[cfg(desktop)]
    #[test]
    #[ignore = "requires a local Python interpreter"]
    fn caps_output_and_stops_timed_out_runs() {
        let executable = find_python().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let run = |script, timeout| {
            let mut process = hidden_command(&executable);
            process.args(["-I", "-u", "-c", script]);
            run_process(process, directory.path(), "", timeout)
                .unwrap()
                .result(false, Instant::now())
        };

        let timeout = run(
            "import time; print('before'); time.sleep(10)",
            Duration::from_secs(1),
        );
        assert_eq!(timeout.status, RunStatus::RuntimeTimeout);
        assert_eq!(timeout.stdout.trim_end(), "before");
        assert_eq!(timeout.exit_code, None);

        let oversized = run("print('a' * 300000)", RUN_TIMEOUT);
        assert_eq!(oversized.status, RunStatus::OutputLimit);
        assert_eq!(oversized.stdout.len(), MAX_OUTPUT_BYTES);
        assert_eq!(oversized.exit_code, None);
    }
}

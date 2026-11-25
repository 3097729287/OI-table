use std::{
    env,
    io::{self, Read, Seek, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

const MAX_SOURCE_BYTES: usize = 256 * 1024;
const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_DIAGNOSTICS: usize = 100;
const CHECK_TIMEOUT: Duration = Duration::from_secs(8);
static CHECK_RUNNING: Mutex<()> = Mutex::new(());

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum EditorLanguage {
    Cpp,
    Python,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostic {
    line: usize,
    column: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    end_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end_column: Option<usize>,
    severity: Severity,
    message: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CheckResult {
    tool: &'static str,
    diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Serialize)]
pub(crate) struct CheckError {
    code: &'static str,
    message: String,
}

impl CheckError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn failed(message: impl Into<String>) -> Self {
        Self::new("check_failed", message)
    }
}

impl From<io::Error> for CheckError {
    fn from(error: io::Error) -> Self {
        Self::failed(error.to_string())
    }
}

type Result<T> = std::result::Result<T, CheckError>;

#[tauri::command]
pub(crate) async fn check_editor_code(
    language: EditorLanguage,
    source: String,
) -> Result<CheckResult> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(CheckError::new(
            "source_too_large",
            "The editor check accepts up to 256 KiB of source",
        ));
    }
    if !cfg!(desktop) {
        return Err(CheckError::new(
            "tool_unavailable",
            "Native editor checks are available on desktop",
        ));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let _running = CHECK_RUNNING.try_lock().map_err(|_| {
            CheckError::new("check_busy", "Another editor check is already running")
        })?;
        let deadline = Instant::now() + CHECK_TIMEOUT;
        match language {
            EditorLanguage::Cpp => check_cpp(&source, deadline),
            EditorLanguage::Python => check_python(&source, deadline),
        }
    })
    .await
    .map_err(|error| CheckError::failed(error.to_string()))?
}

fn find_program(name: &str) -> Option<PathBuf> {
    let paths = env::var_os("PATH")?;
    let executable = format!("{name}{}", env::consts::EXE_SUFFIX);
    env::split_paths(&paths)
        .filter(|directory| directory.is_absolute())
        .map(|directory| directory.join(&executable))
        .find(|path| path.is_file())
}

pub(crate) fn find_cpp() -> Option<(&'static str, PathBuf)> {
    ["g++", "clang++"]
        .into_iter()
        .find_map(|name| find_program(name).map(|path| (name, path)))
}

pub(crate) fn find_python() -> Option<PathBuf> {
    let names = if cfg!(windows) {
        ["python", "python3"]
    } else {
        ["python3", "python"]
    };
    names.into_iter().find_map(find_program)
}

pub(crate) fn hidden_command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        command.process_group(0);
    }
    command
}

struct ToolOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn read_output(pipe: impl Read) -> io::Result<Vec<u8>> {
    let mut output = Vec::new();
    pipe.take(MAX_OUTPUT_BYTES as u64 + 1)
        .read_to_end(&mut output)?;
    if output.len() > MAX_OUTPUT_BYTES {
        return Err(io::Error::other("The checker produced too much output"));
    }
    Ok(output)
}

pub(crate) fn stop_child(child: &mut Child) {
    #[cfg(windows)]
    if let Some(root) = env::var_os("SystemRoot") {
        let taskkill = PathBuf::from(root).join("System32").join("taskkill.exe");
        let _ = hidden_command(&taskkill)
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    stop_process_group(child.id());
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(unix)]
pub(crate) fn stop_process_group(process_id: u32) {
    let _ = Command::new("/bin/kill")
        .args(["-KILL", "--", &format!("-{process_id}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn run_tool(
    program: &Path,
    arguments: &[&str],
    source: &str,
    deadline: Instant,
) -> Result<ToolOutput> {
    let timeout = || CheckError::new("check_timeout", "The editor check exceeded 8 seconds");
    if Instant::now() >= deadline {
        return Err(timeout());
    }

    let mut command = hidden_command(program);
    command.args(arguments).env("LC_ALL", "C");
    let directory = tempfile::tempdir()?;
    let mut input = tempfile::tempfile()?;
    input.write_all(source.as_bytes())?;
    input.rewind()?;
    let mut child = command
        .current_dir(directory.path())
        .stdin(Stdio::from(input))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let stdout = thread::spawn(move || read_output(stdout));
    let stderr = thread::spawn(move || read_output(stderr));

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                stop_child(&mut child);
                return Err(timeout());
            }
            Err(error) => {
                stop_child(&mut child);
                return Err(error.into());
            }
        }
    };

    let read_failed = || CheckError::failed("Could not read diagnostics from the checker");
    Ok(ToolOutput {
        status,
        stdout: stdout.join().map_err(|_| read_failed())??,
        stderr: stderr.join().map_err(|_| read_failed())??,
    })
}

fn check_cpp(source: &str, deadline: Instant) -> Result<CheckResult> {
    let (tool, executable) = find_cpp().ok_or_else(|| {
        CheckError::new(
            "tool_unavailable",
            "No C++ checker found. Install g++ or clang++ on PATH.",
        )
    })?;
    let mut arguments = vec![
        "-x",
        "c++",
        "-std=gnu++17",
        "-fsyntax-only",
        "-Wall",
        "-Wextra",
    ];
    if tool == "g++" {
        arguments.extend([
            "-fdiagnostics-color=never",
            "-fno-diagnostics-show-caret",
            "-fdiagnostics-column-unit=byte",
            "-",
        ]);
    } else {
        arguments.extend(["-fno-color-diagnostics", "-fno-caret-diagnostics", "-"]);
    }

    let mut output = run_tool(&executable, &arguments, source, deadline)?;
    if tool == "g++" && !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // GCC releases before the column-unit option reported byte columns by default.
        if stderr.contains("unrecognized command line option")
            && stderr.contains("-fdiagnostics-column-unit=byte")
        {
            arguments.retain(|argument| *argument != "-fdiagnostics-column-unit=byte");
            output = run_tool(&executable, &arguments, source, deadline)?;
        }
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let diagnostics = parse_cpp_diagnostics(source, &stderr);
    if !output.status.success()
        && !diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == Severity::Error)
    {
        return Err(CheckError::failed(
            "The C++ checker did not return diagnostics for this source",
        ));
    }
    Ok(CheckResult { tool, diagnostics })
}

fn parse_cpp_diagnostics(source: &str, stderr: &str) -> Vec<Diagnostic> {
    let lines: Vec<_> = source.split('\n').collect();
    stderr
        .lines()
        .filter_map(|output| {
            let mut fields = output.strip_prefix("<stdin>:")?.splitn(4, ':');
            let line = fields.next()?.parse::<usize>().ok()?;
            let column = fields.next()?.parse::<usize>().ok()?;
            let severity = match fields.next()?.trim() {
                "error" | "fatal error" => Severity::Error,
                "warning" => Severity::Warning,
                _ => return None,
            };
            let text = lines.get(line.checked_sub(1)?)?.trim_end_matches('\r');
            let byte_index = column.saturating_sub(1).min(text.len());
            let column = text
                .char_indices()
                .take_while(|(index, _)| *index < byte_index)
                .count()
                + 1;
            Some(Diagnostic {
                line,
                column,
                end_line: None,
                end_column: None,
                severity,
                message: fields.next()?.trim().to_owned(),
            })
        })
        .take(MAX_DIAGNOSTICS)
        .collect()
}

#[derive(Deserialize)]
struct RuffLocation {
    row: usize,
    column: usize,
}

#[derive(Deserialize)]
struct RuffDiagnostic {
    location: RuffLocation,
    end_location: Option<RuffLocation>,
    code: Option<String>,
    severity: Option<Severity>,
    message: String,
}

fn parse_ruff_diagnostics(stdout: &[u8]) -> serde_json::Result<Vec<Diagnostic>> {
    let findings = serde_json::from_slice::<Vec<RuffDiagnostic>>(stdout)?;
    Ok(findings
        .into_iter()
        .take(MAX_DIAGNOSTICS)
        .map(|finding| Diagnostic {
            line: finding.location.row.max(1),
            column: finding.location.column.max(1),
            end_line: finding.end_location.as_ref().map(|end| end.row),
            end_column: finding.end_location.as_ref().map(|end| end.column),
            severity: finding
                .severity
                .unwrap_or_else(|| match finding.code.as_deref() {
                    None | Some("invalid-syntax" | "E999" | "F821") => Severity::Error,
                    _ => Severity::Warning,
                }),
            message: finding.message,
        })
        .collect())
}

const PYTHON_CHECK_SCRIPT: &str = r#"
import json
import sys

try:
    compile(sys.stdin.buffer.read().decode('utf-8'), '<editor>', 'exec')
except SyntaxError as error:
    line = max(1, error.lineno or 1)
    column = max(1, error.offset or 1)
    result = dict(line=line, column=column, severity='error', message=error.msg)
    end_line = getattr(error, 'end_lineno', None)
    end_column = getattr(error, 'end_offset', None)
    if end_line and end_column and end_column > 0 and (end_line, end_column) > (line, column):
        result.update(endLine=end_line, endColumn=end_column)
    print(json.dumps(result))
else:
    print('null')
"#;

fn check_python(source: &str, deadline: Instant) -> Result<CheckResult> {
    let ruff = find_program("ruff");
    if let Some(executable) = &ruff {
        let arguments = [
            "check",
            "--isolated",
            "--no-cache",
            "--output-format",
            "json",
            "--stdin-filename",
            "solution.py",
            "-",
        ];
        match run_tool(executable, &arguments, source, deadline) {
            Ok(output) if matches!(output.status.code(), Some(0 | 1)) => {
                if let Ok(diagnostics) = parse_ruff_diagnostics(&output.stdout) {
                    return Ok(CheckResult {
                        tool: "Ruff",
                        diagnostics,
                    });
                }
            }
            Err(error) if error.code == "check_timeout" => return Err(error),
            _ => (),
        }
    }

    let Some(executable) = find_python() else {
        return Err(if ruff.is_some() {
            CheckError::failed("Ruff did not return Python diagnostics")
        } else {
            CheckError::new(
                "tool_unavailable",
                "No Python checker found. Install Ruff or Python 3 on PATH.",
            )
        });
    };
    let output = run_tool(
        &executable,
        &["-I", "-S", "-B", "-c", PYTHON_CHECK_SCRIPT],
        source,
        deadline,
    )?;
    if !output.status.success() {
        return Err(CheckError::failed(
            "Python did not return diagnostics for this source",
        ));
    }
    let diagnostic = serde_json::from_slice::<Option<Diagnostic>>(&output.stdout)
        .map_err(|_| CheckError::failed("Python returned invalid diagnostics"))?;
    Ok(CheckResult {
        tool: "Python",
        diagnostics: diagnostic.into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_compiler_errors_and_warnings_as_character_columns() {
        let source = "/*界*/ missing\nint unused;";
        let stderr = "<stdin>: In function 'main':\n<stdin>:1:9: error: unknown identifier\n<stdin>:2:5: warning: unused variable\nheader.h:20:1: error: other file\n<stdin>:1:5: note: note\n";
        let diagnostic = parse_cpp_diagnostics(source, stderr);
        assert_eq!(diagnostic.len(), 2);
        assert_eq!(
            (
                diagnostic[0].line,
                diagnostic[0].column,
                &diagnostic[0].severity
            ),
            (1, 7, &Severity::Error)
        );
        assert_eq!(
            (
                diagnostic[1].line,
                diagnostic[1].column,
                &diagnostic[1].severity
            ),
            (2, 5, &Severity::Warning)
        );
    }

    #[test]
    fn parses_ruff_ranges_and_tracks_syntax_errors() {
        let stdout = br#"[{"location":{"row":2,"column":7},"end_location":{"row":2,"column":12},"code":"invalid-syntax","message":"Expected ':'"}]"#;
        let diagnostic = parse_ruff_diagnostics(stdout).unwrap().pop().unwrap();
        assert_eq!(
            diagnostic,
            Diagnostic {
                line: 2,
                column: 7,
                end_line: Some(2),
                end_column: Some(12),
                severity: Severity::Error,
                message: "Expected ':'".into(),
            }
        );
    }

    #[cfg(desktop)]
    #[test]
    #[ignore = "requires local C++ and Python checkers"]
    fn checks_drafts_with_installed_tools() {
        let deadline = || Instant::now() + CHECK_TIMEOUT;
        let cpp = check_cpp("int main() { return unknown; }", deadline()).unwrap();
        assert_eq!(cpp.diagnostics[0].line, 1);
        assert_eq!(cpp.diagnostics[0].severity, Severity::Error);

        let python = check_python("if True print(42)", deadline()).unwrap();
        assert_eq!(python.diagnostics[0].line, 1);
        assert_eq!(python.diagnostics[0].severity, Severity::Error);

        let executable = find_program("python")
            .or_else(|| find_program("python3"))
            .unwrap();
        let output = run_tool(
            &executable,
            &["-I", "-S", "-B", "-c", PYTHON_CHECK_SCRIPT],
            "raise RuntimeError('checking must not run this draft')",
            deadline(),
        )
        .unwrap();
        assert!(output.status.success());
        assert!(serde_json::from_slice::<Option<Diagnostic>>(&output.stdout)
            .unwrap()
            .is_none());
    }
}

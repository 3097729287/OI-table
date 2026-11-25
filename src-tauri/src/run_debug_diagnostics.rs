use std::{path::Path, thread};

use serde::Serialize;
use tauri::ipc::Channel;

use crate::{
    editor_debug::{verify_debug_fixture, DebugError, DebugPhase, EditorDebugState},
    editor_run::{
        find_cpp, find_program, find_python, probe_editor_tool, verify_run_fixture, EditorLanguage,
    },
};

const SAMPLE_INPUT: &str = "21\n";
const SAMPLE_RESULT: &str = "42";
const CPP_SAMPLE: &str = concat!(
    "#include <iostream>\n",
    "int twice(int value) {\n",
    "    int result = value * 2;\n",
    "    return result;\n",
    "}\n",
    "int main() {\n",
    "    int value = 0;\n",
    "    std::cin >> value;\n",
    "    std::cout << twice(value) << '\\n';\n",
    "}\n",
);
const CPP_BREAKPOINT: u32 = 4;
const PYTHON_SAMPLE: &str = concat!(
    "def twice(value):\n",
    "    result = value * 2\n",
    "    return result\n",
    "\n",
    "print(twice(int(input())))\n",
);
const PYTHON_BREAKPOINT: u32 = 3;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    Checking,
    Ready,
    Missing,
    Failed,
    Unchecked,
    Busy,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum ToolId {
    Cpp,
    Python,
    Gdb,
}

impl ToolId {
    fn missing_detail(self) -> &'static str {
        match self {
            Self::Cpp => "Install g++ or clang++ and add its executable directory to PATH.",
            Self::Python => "Install Python 3 and add its executable directory to PATH.",
            Self::Gdb => {
                "Install GNU GDB for your C++ toolchain and add its executable directory to PATH."
            }
        }
    }
}

#[derive(Serialize)]
struct ToolReport {
    id: ToolId,
    status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum CheckId {
    CppRun,
    PythonRun,
    CppDebug,
    PythonDebug,
}

#[derive(Clone, Serialize)]
pub(crate) struct CheckReport {
    id: CheckId,
    status: Status,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<DebugPhase>,
}

#[derive(Serialize)]
pub(crate) struct RunDebugReport {
    tools: [ToolReport; 3],
    checks: [CheckReport; 4],
}

struct Issue {
    status: Status,
    detail: String,
    phase: Option<DebugPhase>,
}

impl Issue {
    fn from_error(code: &str, detail: String) -> Self {
        let status = match code {
            "run_busy" | "debug_busy" => Status::Busy,
            "tool_unavailable" => Status::Missing,
            _ => Status::Failed,
        };
        Self {
            status,
            detail,
            phase: None,
        }
    }

    fn from_debug_error(error: DebugError) -> Self {
        Self {
            phase: error.phase,
            ..Self::from_error(error.code, error.message)
        }
    }
}

#[tauri::command]
pub(crate) async fn check_run_debug_environment(
    state: tauri::State<'_, EditorDebugState>,
    run_self_tests: bool,
    on_progress: Channel<CheckReport>,
) -> Result<RunDebugReport, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        collect_report(&state, run_self_tests, Some(&on_progress))
    })
    .await
    .map_err(|error| error.to_string())
}

fn collect_report(
    state: &EditorDebugState,
    run_self_tests: bool,
    on_progress: Option<&Channel<CheckReport>>,
) -> RunDebugReport {
    if !cfg!(desktop) {
        const DETAIL: &str = "Local runs and debugging are available in the desktop app.";
        return RunDebugReport {
            tools: [ToolId::Cpp, ToolId::Python, ToolId::Gdb].map(|id| ToolReport {
                id,
                status: Status::Missing,
                path: None,
                version: None,
                detail: Some(DETAIL.into()),
            }),
            checks: [
                CheckId::CppRun,
                CheckId::PythonRun,
                CheckId::CppDebug,
                CheckId::PythonDebug,
            ]
            .map(|id| {
                let report = CheckReport {
                    id,
                    status: Status::Missing,
                    detail: Some(DETAIL.into()),
                    phase: None,
                };
                publish(on_progress, &report);
                report
            }),
        };
    }

    let compiler = find_cpp().map(|(_, path)| path);
    let interpreter = find_python();
    let debugger = find_program("gdb");
    let (cpp, python, gdb, python_bdb) = thread::scope(|scope| {
        let cpp = scope.spawn(|| probe_version(ToolId::Cpp, compiler.as_deref()));
        let gdb = scope.spawn(|| probe_version(ToolId::Gdb, debugger.as_deref()));
        let python = probe_version(ToolId::Python, interpreter.as_deref());
        let python_bdb = prerequisites(&[&python]).and_then(|()| {
            if let Some(path) = interpreter.as_deref() {
                probe_python_bdb(path)
            } else {
                Err(Issue::from_error(
                    "tool_unavailable",
                    ToolId::Python.missing_detail().into(),
                ))
            }
        });
        (
            cpp.join().expect("C++ tool probe"),
            python,
            gdb.join().expect("GDB tool probe"),
            python_bdb,
        )
    });

    // The runner and debugger have separate busy slots. Run their lanes in
    // parallel while keeping the two checks within each lane sequential.
    let checks = thread::scope(|scope| {
        let run = scope.spawn(|| {
            [
                check(
                    CheckId::CppRun,
                    prerequisites(&[&cpp]),
                    run_self_tests,
                    on_progress,
                    || {
                        verify_run_fixture(
                            EditorLanguage::Cpp,
                            CPP_SAMPLE,
                            SAMPLE_INPUT,
                            SAMPLE_RESULT,
                        )
                        .map_err(|error| Issue::from_error(error.code, error.message))
                    },
                ),
                check(
                    CheckId::PythonRun,
                    prerequisites(&[&python]),
                    run_self_tests,
                    on_progress,
                    || {
                        verify_run_fixture(
                            EditorLanguage::Python,
                            PYTHON_SAMPLE,
                            SAMPLE_INPUT,
                            SAMPLE_RESULT,
                        )
                        .map_err(|error| Issue::from_error(error.code, error.message))
                    },
                ),
            ]
        });
        let cpp_debug = check(
            CheckId::CppDebug,
            prerequisites(&[&cpp, &gdb]),
            run_self_tests,
            on_progress,
            || {
                verify_debug_fixture(
                    state,
                    EditorLanguage::Cpp,
                    CPP_SAMPLE,
                    SAMPLE_INPUT,
                    CPP_BREAKPOINT,
                    SAMPLE_RESULT,
                )
                .map_err(Issue::from_debug_error)
            },
        );
        let python_debug = check(
            CheckId::PythonDebug,
            python_bdb,
            run_self_tests,
            on_progress,
            || {
                verify_debug_fixture(
                    state,
                    EditorLanguage::Python,
                    PYTHON_SAMPLE,
                    SAMPLE_INPUT,
                    PYTHON_BREAKPOINT,
                    SAMPLE_RESULT,
                )
                .map_err(Issue::from_debug_error)
            },
        );
        let [cpp_run, python_run] = run.join().expect("run self-test lane");
        [cpp_run, python_run, cpp_debug, python_debug]
    });
    RunDebugReport {
        tools: [cpp, python, gdb],
        checks,
    }
}

fn probe_version(id: ToolId, path: Option<&Path>) -> ToolReport {
    let Some(path) = path else {
        return ToolReport {
            id,
            status: Status::Missing,
            path: None,
            version: None,
            detail: Some(id.missing_detail().into()),
        };
    };
    let mut report = ToolReport {
        id,
        status: Status::Failed,
        path: Some(path.to_string_lossy().into_owned()),
        version: None,
        detail: None,
    };
    match probe_editor_tool(path, &["--version"]) {
        Ok(output) if !output.is_empty() => {
            let version = output.lines().next().unwrap_or_default().trim();
            report.version = Some(limited_detail(version));
            if matches!(id, ToolId::Python) && !version.starts_with("Python 3.") {
                report.detail = Some(
                    "The selected interpreter is not Python 3. Update PATH to select Python 3."
                        .into(),
                );
            } else {
                report.status = Status::Ready;
            }
        }
        Ok(_) => report.detail = Some("The selected tool did not report its version.".into()),
        Err(detail) => report.detail = Some(limited_detail(&detail)),
    }
    report
}

fn probe_python_bdb(path: &Path) -> Result<(), Issue> {
    const BDB_PROBE: &str = concat!(
        "import sys\n",
        "from bdb import Bdb\n",
        "from types import MethodDescriptorType, WrapperDescriptorType\n",
        "if not sys.flags.utf8_mode:\n",
        "    raise RuntimeError('Python UTF-8 mode is unavailable')\n",
    );
    probe_editor_tool(path, &["-I", "-B", "-u", "-X", "utf8", "-c", BDB_PROBE])
        .map(|_| ())
        .map_err(|error| Issue {
            status: Status::Failed,
            detail: format!(
                "The selected Python cannot load the standard debugger module bdb.\n{error}"
            ),
            phase: None,
        })
}

fn prerequisites(tools: &[&ToolReport]) -> Result<(), Issue> {
    match tools.iter().find(|tool| tool.status != Status::Ready) {
        Some(tool) => Err(Issue {
            status: tool.status,
            detail: tool.detail.clone().unwrap_or_default(),
            phase: None,
        }),
        None => Ok(()),
    }
}

fn check(
    id: CheckId,
    prerequisites: Result<(), Issue>,
    run_self_tests: bool,
    on_progress: Option<&Channel<CheckReport>>,
    verify: impl FnOnce() -> Result<(), Issue>,
) -> CheckReport {
    let result = prerequisites.and_then(|()| {
        if !run_self_tests {
            return Ok(());
        }
        publish(
            on_progress,
            &CheckReport {
                id,
                status: Status::Checking,
                detail: None,
                phase: None,
            },
        );
        verify()
    });
    let report = match result {
        Ok(()) => CheckReport {
            id,
            status: if run_self_tests {
                Status::Ready
            } else {
                Status::Unchecked
            },
            detail: None,
            phase: None,
        },
        Err(issue) => CheckReport {
            id,
            status: issue.status,
            detail: Some(limited_detail(&issue.detail)),
            phase: issue.phase,
        },
    };
    publish(on_progress, &report);
    report
}

fn publish(channel: Option<&Channel<CheckReport>>, report: &CheckReport) {
    if let Some(channel) = channel {
        let _ = channel.send(report.clone());
    }
}

fn limited_detail(text: &str) -> String {
    const MAX_DETAIL_CHARACTERS: usize = 1000;
    let mut characters = text.chars();
    let mut output = characters
        .by_ref()
        .take(MAX_DETAIL_CHARACTERS)
        .collect::<String>();
    if characters.next().is_some() {
        output.push('…');
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_prerequisite_skips_the_sample() {
        let missing = probe_version(ToolId::Gdb, None);
        let check = check(
            CheckId::CppDebug,
            prerequisites(&[&missing]),
            true,
            None,
            || panic!("missing tools must not launch a self-test"),
        );
        let check = serde_json::to_value(check).unwrap();
        assert_eq!(check["id"], "cppDebug");
        assert_eq!(check["status"], "missing");
    }

    #[test]
    fn probe_only_leaves_ready_checks_unchecked() {
        let check = check(CheckId::PythonRun, Ok(()), false, None, || {
            panic!("a passive probe must not launch a self-test")
        });
        let check = serde_json::to_value(check).unwrap();
        assert_eq!(check["status"], "unchecked");
    }

    #[test]
    fn debug_self_test_reports_the_stage_of_a_timeout() {
        let report = check(CheckId::CppDebug, Ok(()), true, None, || {
            Err(Issue::from_debug_error(DebugError {
                code: "debug_timeout",
                message: "No stop event was received.".into(),
                phase: Some(DebugPhase::ProgramStop),
            }))
        });
        let report = serde_json::to_value(report).unwrap();
        assert_eq!(report["status"], "failed");
        assert_eq!(report["phase"], "programStop");
        assert_eq!(report["detail"], "No stop event was received.");
    }

    #[test]
    fn self_test_publishes_progress_before_and_after_the_sample() {
        use std::sync::{Arc, Mutex};
        use tauri::ipc::InvokeResponseBody;

        let reports = Arc::new(Mutex::new(Vec::new()));
        let received = Arc::clone(&reports);
        let channel = Channel::new(move |message| {
            let InvokeResponseBody::Json(payload) = message else {
                panic!("check progress must be serialized as JSON");
            };
            received
                .lock()
                .unwrap()
                .push(serde_json::from_str::<serde_json::Value>(&payload).unwrap());
            Ok(())
        });
        let complete = check(CheckId::PythonRun, Ok(()), true, Some(&channel), || {
            let reports = reports.lock().unwrap();
            assert_eq!(reports.len(), 1);
            assert_eq!(reports[0]["id"], "pythonRun");
            assert_eq!(reports[0]["status"], "checking");
            Ok(())
        });
        let reports = reports.lock().unwrap();
        assert_eq!(reports.len(), 2);
        assert_eq!(reports[1]["status"], "ready");
        assert_eq!(reports[1], serde_json::to_value(complete).unwrap());
    }

    #[test]
    #[ignore = "requires a C++ compiler, Python, GDB, and permission to debug a child process"]
    fn checks_actual_run_and_debug_toolchains() {
        let report = collect_report(&EditorDebugState::default(), true, None);
        let report = serde_json::to_value(report).unwrap();
        for tool in report["tools"].as_array().unwrap() {
            assert_eq!(tool["status"], "ready", "{tool}");
            assert!(tool["path"].is_string());
            assert!(tool["version"].is_string());
        }
        for check in report["checks"].as_array().unwrap() {
            assert_eq!(check["status"], "ready", "{check}");
        }
    }
}

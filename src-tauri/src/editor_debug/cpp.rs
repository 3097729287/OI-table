use std::{collections::BTreeMap, path::Path, time::Instant};

use crate::editor_run::{find_cpp, find_program};

use super::{
    compile_cpp, hidden_command, ActiveDebug, DebugAction, DebugError, DebugFrame,
    DebugFrameVariables, DebugLocation, DebugPhase, DebugReason, DebugStatus, DebugVariable,
    Result, Transport, DEBUG_TIMEOUT,
};

mod globals;
mod mi;
mod variables;
#[cfg(windows)]
mod windows_inferior;

pub(super) struct Debugger {
    transport: Transport,
    #[cfg(windows)]
    inferior: Option<windows_inferior::Inferior>,
    token: u32,
    breakpoints: BTreeMap<u32, Option<u32>>,
    variables: variables::VariableTable,
    globals: Option<globals::DraftGlobals>,
}

impl Debugger {
    pub(super) fn start(
        root: &Path,
        breakpoints: &[u32],
        active: &ActiveDebug,
    ) -> Result<(Self, DebugLocation)> {
        let (_, compiler) = find_cpp().ok_or_else(|| {
            DebugError::new(
                "tool_unavailable",
                "Install g++ or clang++ and add it to PATH.",
            )
        })?;
        let gdb = find_program("gdb").ok_or_else(|| {
            DebugError::new("tool_unavailable", "Install GDB and add it to PATH.")
        })?;
        let binary = format!("solution{}", std::env::consts::EXE_SUFFIX);
        let mut command = hidden_command(&gdb);
        command
            .current_dir(root)
            .env("LC_ALL", "C")
            .env_remove("DEBUGINFOD_URLS")
            .args(["--nx", "--quiet", "--interpreter=mi2"]);
        // Let GDB start while the compiler produces the executable. Load the
        // symbols only after a successful compile.
        let transport = Transport::spawn(command, root);
        compile_cpp(&compiler, root, &binary, active)?;
        let mut debugger = Self {
            transport: transport?,
            #[cfg(windows)]
            inferior: None,
            token: 0,
            breakpoints: BTreeMap::new(),
            variables: variables::VariableTable::default(),
            globals: None,
        };
        #[cfg(windows)]
        {
            // Windows can take time to start a freshly linked executable. The
            // child waits before running any draft code while GDB loads symbols.
            let inferior = std::thread::scope(|scope| {
                let inferior =
                    scope.spawn(|| windows_inferior::Inferior::start(root, &binary, active));
                let configured = debugger.configure(&binary, active);
                let inferior = inferior.join().expect("start C++ debug program");
                configured?;
                inferior
            })?;
            // Older MinGW GDB can stall when it launches the program itself.
            let attach = format!("-target-attach {}", inferior.id());
            debugger.inferior = Some(inferior);
            debugger.execute(&attach, Instant::now() + DEBUG_TIMEOUT, active)?;
        }
        #[cfg(not(windows))]
        debugger.configure(&binary, active)?;
        let deadline = Instant::now() + DEBUG_TIMEOUT;
        debugger.set_breakpoints(breakpoints, deadline, active)?;
        let at_entry = debugger.breakpoints.values().all(Option::is_none);
        if at_entry {
            debugger.command("-break-insert -t main", deadline, active)?;
        }
        #[cfg(windows)]
        let launch = {
            active.check_cancelled()?;
            if let Some(inferior) = &debugger.inferior {
                inferior.release()?;
            }
            "-exec-continue"
        };
        #[cfg(not(windows))]
        let launch = "-exec-run";
        let stopped = debugger.execute(launch, Instant::now() + DEBUG_TIMEOUT, active)?;
        let location = debugger.location(stopped, at_entry, active)?;
        Ok((debugger, location))
    }

    fn configure(&mut self, binary: &str, active: &ActiveDebug) -> Result<()> {
        let deadline = Instant::now() + DEBUG_TIMEOUT;
        for setup in [
            "-gdb-set pagination off",
            "-gdb-set confirm off",
            "-gdb-set print elements 20",
            "-gdb-set print repeats 8",
        ] {
            self.command(setup, deadline, active)?;
        }
        // GDB builds without Python still expose native arrays and aggregate fields.
        self.exchange("-enable-pretty-printing", deadline, active)?;
        self.exchange("-gdb-set print characters 1024", deadline, active)?;
        self.command(
            &format!("-file-exec-and-symbols {binary}"),
            deadline,
            active,
        )?;
        Ok(())
    }

    pub(super) fn step(
        &mut self,
        action: DebugAction,
        breakpoints: &[u32],
        active: &ActiveDebug,
    ) -> Result<DebugLocation> {
        let deadline = Instant::now() + DEBUG_TIMEOUT;
        self.clear_variables(deadline, active)?;
        self.set_breakpoints(breakpoints, deadline, active)?;
        let command = match action {
            DebugAction::Continue => "-exec-continue",
            DebugAction::StepOver => "-exec-next",
            DebugAction::StepInto => "-exec-step",
            DebugAction::StepOut => "-exec-finish",
        };
        let execution_deadline = Instant::now() + DEBUG_TIMEOUT;
        let mut stopped = self.execute(command, execution_deadline, active)?;
        // A single step can enter the C++ runtime or a standard library header.
        // Step back to the nearest caller in the draft before exposing the next stop.
        while matches!(
            stopped.string("reason"),
            Some("end-stepping-range" | "function-finished")
        ) && draft_line(stopped.get("frame")).is_none()
        {
            let frames = self
                .frames(execution_deadline, active)
                .map_err(|error| error.with_phase(DebugPhase::Inspection))?;
            let command = if frames.is_empty() {
                "-exec-continue"
            } else {
                "-exec-finish"
            };
            stopped = self.execute(command, execution_deadline, active)?;
        }
        self.location(stopped, false, active)
    }

    pub(super) fn inspect(
        &mut self,
        frame: u32,
        active: &ActiveDebug,
    ) -> Result<DebugFrameVariables> {
        self.variables(frame, Instant::now() + DEBUG_TIMEOUT, active)
            .map_err(|error| error.with_phase(DebugPhase::Inspection))
    }

    pub(super) fn children(
        &mut self,
        reference: u32,
        active: &ActiveDebug,
    ) -> Result<Vec<DebugVariable>> {
        self.variable_children(reference, Instant::now() + DEBUG_TIMEOUT, active)
            .map_err(|error| error.with_phase(DebugPhase::Inspection))
    }

    fn set_breakpoints(
        &mut self,
        lines: &[u32],
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<()> {
        let removed = self
            .breakpoints
            .keys()
            .filter(|line| lines.binary_search(line).is_err())
            .copied()
            .collect::<Vec<_>>();
        for line in removed {
            if let Some(Some(id)) = self.breakpoints.remove(&line) {
                self.command(&format!("-break-delete {id}"), deadline, active)?;
            }
        }
        for line in lines {
            if self.breakpoints.contains_key(line) {
                continue;
            }
            let record = self.exchange(
                &format!("-break-insert solution.cpp:{line}"),
                deadline,
                active,
            )?;
            let id = match record.class.as_str() {
                "done" => record
                    .values
                    .get("bkpt")
                    .and_then(|breakpoint| breakpoint.number("number")),
                // GDB rejects lines without executable or debug information.
                "error" => None,
                _ => {
                    return Err(DebugError::failed(
                        "GDB could not set the requested breakpoint.",
                    ))
                }
            };
            self.breakpoints.insert(*line, id);
        }
        Ok(())
    }

    fn location(
        &mut self,
        stopped: mi::Value,
        entry: bool,
        active: &ActiveDebug,
    ) -> Result<DebugLocation> {
        let reason = match stopped.string("reason") {
            Some("exited-normally") => return Ok(DebugLocation::finished(DebugReason::Exited)),
            Some("exited-signalled") => return Ok(DebugLocation::finished(DebugReason::Signal)),
            Some("exited") => {
                let reason = if stopped
                    .string("exit-code")
                    .is_some_and(|code| code != "0" && code != "00")
                {
                    DebugReason::Exception
                } else {
                    DebugReason::Exited
                };
                return Ok(DebugLocation::finished(reason));
            }
            Some("breakpoint-hit") if entry => DebugReason::Entry,
            Some("breakpoint-hit") => DebugReason::Breakpoint,
            Some("signal-received") => DebugReason::Signal,
            _ => DebugReason::Step,
        };
        let deadline = Instant::now() + DEBUG_TIMEOUT;
        let (frames, scope) = (|| {
            let frames = self.frames(deadline, active)?;
            let scope = match frames.first() {
                Some(frame) => self.variables(frame.id, deadline, active)?,
                None => DebugFrameVariables::default(),
            };
            Ok::<_, DebugError>((frames, scope))
        })()
        .map_err(|error| error.with_phase(DebugPhase::Inspection))?;
        Ok(DebugLocation {
            status: DebugStatus::Paused,
            reason,
            line: draft_line(stopped.get("frame")),
            frames,
            scope,
        })
    }

    fn frames(&mut self, deadline: Instant, active: &ActiveDebug) -> Result<Vec<DebugFrame>> {
        let result = self.command("-stack-list-frames 0 63", deadline, active)?;
        Ok(result
            .list("stack")
            .filter_map(|value| {
                Some(DebugFrame {
                    id: value.number("level")?,
                    name: value.string("func")?.chars().take(160).collect(),
                    line: draft_line(Some(value))?,
                })
            })
            .collect())
    }

    fn in_frame<T>(
        &mut self,
        frame: u32,
        deadline: Instant,
        active: &ActiveDebug,
        operation: impl FnOnce(&mut Self) -> Result<T>,
    ) -> Result<T> {
        if frame != 0 {
            self.command(&format!("-stack-select-frame {frame}"), deadline, active)?;
        }
        let result = operation(self);
        if frame != 0 {
            self.command("-stack-select-frame 0", deadline, active)?;
        }
        result
    }

    fn execute(
        &mut self,
        command: &str,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<mi::Value> {
        let token = self.send(command, active)?;
        wait_for_stop(&token, |phase| {
            let phase = if command.starts_with("-target-attach ") {
                DebugPhase::DebuggerReply
            } else {
                phase
            };
            self.transport.receive(deadline, active, phase)
        })
        .map_err(|error| command_error(command, error))
    }

    fn command(
        &mut self,
        command: &str,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<mi::Value> {
        Self::accept(self.exchange(command, deadline, active)?)
    }

    fn accept(result: mi::Record) -> Result<mi::Value> {
        match result.class.as_str() {
            "done" | "running" => Ok(result.values),
            _ => Err(DebugError::failed(
                result
                    .values
                    .string("msg")
                    .unwrap_or("GDB rejected the command."),
            )),
        }
    }

    fn exchange(
        &mut self,
        command: &str,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<mi::Record> {
        self.exchange_with_console(command, deadline, active, |_| {})
    }

    fn exchange_with_console(
        &mut self,
        command: &str,
        deadline: Instant,
        active: &ActiveDebug,
        mut on_console: impl FnMut(&str),
    ) -> Result<mi::Record> {
        let prefix = format!("{}^", self.send(command, active)?);
        loop {
            let line = self
                .transport
                .receive(deadline, active, DebugPhase::DebuggerReply)
                .map_err(|error| command_error(command, error))?;
            if let Some(record) = line.trim_end().strip_prefix(&prefix) {
                return mi::record(record);
            }
            if let Some(message) = line.trim_end().strip_prefix('~') {
                if let Some(message) = mi::console_text(message) {
                    on_console(&message);
                }
            }
        }
    }

    fn send(&mut self, command: &str, active: &ActiveDebug) -> Result<String> {
        self.token += 1;
        let token = self.token.to_string();
        self.transport.send(&format!("{token}{command}"), active)?;
        Ok(token)
    }
}

fn command_error(command: &str, mut error: DebugError) -> DebugError {
    if error.code == "debug_timeout" {
        let operation = if command.starts_with("-gdb-set ") {
            Some(command)
        } else {
            command.split_ascii_whitespace().next()
        };
        if let Some(operation) = operation {
            error.message = format!("{} (GDB command {operation})", error.message);
        }
    }
    error
}

fn wait_for_stop(
    token: &str,
    mut receive: impl FnMut(DebugPhase) -> Result<String>,
) -> Result<mi::Value> {
    let reply = format!("{token}^");
    let mut phase = DebugPhase::DebuggerReply;
    loop {
        let line = receive(phase)?;
        let line = line.trim_end();
        // A stop can be delivered before GDB's command result. Keep watching
        // for it from the moment the execution command is written.
        if let Some(fields) = mi::exec_fields(line, token, "stopped") {
            return mi::fields(fields);
        }
        if let Some(record) = line.strip_prefix(&reply) {
            Debugger::accept(mi::record(record)?)?;
            phase = DebugPhase::ProgramStop;
        } else if mi::exec_fields(line, token, "running").is_some() {
            phase = DebugPhase::ProgramStop;
        }
    }
}

fn draft_line(frame: Option<&mi::Value>) -> Option<u32> {
    let frame = frame?;
    if is_draft_file(frame.string("file")?) {
        frame.number("line")
    } else {
        None
    }
}

fn is_draft_file(filename: &str) -> bool {
    filename.rsplit(['/', '\\']).next() == Some("solution.cpp")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_keeps_an_early_stop_before_the_command_reply() {
        let mut events = [
            "23*stopped,reason=\"breakpoint-hit\",frame={line=\"7\"}",
            "23^running",
        ]
        .into_iter();
        let stopped = wait_for_stop("23", |phase| {
            assert!(matches!(phase, DebugPhase::DebuggerReply));
            Ok(events.next().expect("both MI events were consumed").into())
        })
        .unwrap();
        assert_eq!(stopped.string("reason"), Some("breakpoint-hit"));
        assert_eq!(
            stopped.get("frame").and_then(|frame| frame.number("line")),
            Some(7)
        );
        assert_eq!(events.next(), Some("23^running"));
    }

    #[test]
    fn execution_waits_for_the_stop_after_the_command_reply() {
        let mut events = [
            ("23^running", false),
            ("24*stopped,reason=\"breakpoint-hit\"", true),
            ("*stopped,reason=\"exited-normally\"", true),
        ]
        .into_iter();
        let stopped = wait_for_stop("23", |phase| {
            let (event, program_running) = events.next().expect("expected another MI event");
            assert_eq!(matches!(phase, DebugPhase::ProgramStop), program_running);
            Ok(event.into())
        })
        .unwrap();
        assert_eq!(stopped.string("reason"), Some("exited-normally"));
    }
}

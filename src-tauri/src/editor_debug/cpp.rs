use std::{collections::BTreeMap, path::Path, time::Instant};

use crate::editor_run::{find_cpp, find_program};

use super::{
    compile_cpp, hidden_command, ActiveDebug, DebugAction, DebugError, DebugFrame,
    DebugFrameVariables, DebugLocation, DebugReason, DebugStatus, DebugVariable, Result, Transport,
    DEBUG_TIMEOUT,
};

mod globals;
mod mi;
mod variables;

pub(super) struct Debugger {
    transport: Transport,
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
        compile_cpp(&compiler, root, &binary, active)?;
        let mut command = hidden_command(&gdb);
        command
            .current_dir(root)
            .env("LC_ALL", "C")
            .env_remove("DEBUGINFOD_URLS")
            .args(["--nx", "--quiet", "--interpreter=mi2", &binary]);
        let mut debugger = Self {
            transport: Transport::spawn(command, root)?,
            token: 0,
            breakpoints: BTreeMap::new(),
            variables: variables::VariableTable::default(),
            globals: None,
        };
        let deadline = Instant::now() + DEBUG_TIMEOUT;
        for setup in [
            "-gdb-set pagination off",
            "-gdb-set confirm off",
            "-gdb-set print elements 20",
            "-gdb-set print repeats 8",
        ] {
            debugger.command(setup, deadline, active)?;
        }
        // GDB builds without Python still expose native arrays and aggregate fields.
        debugger.exchange("-enable-pretty-printing", deadline, active)?;
        debugger.exchange("-gdb-set print characters 1024", deadline, active)?;
        debugger.set_breakpoints(breakpoints, deadline, active)?;
        let at_entry = debugger.breakpoints.values().all(Option::is_none);
        if at_entry {
            debugger.command("-break-insert -t main", deadline, active)?;
        }
        let stopped = debugger.execute("-exec-run", deadline, active)?;
        let location = debugger.location(stopped, at_entry, deadline, active)?;
        Ok((debugger, location))
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
        let mut stopped = self.execute(command, deadline, active)?;
        // A single step can enter the C++ runtime or a standard library header.
        // Step back to the nearest caller in the draft before exposing the next stop.
        while matches!(
            stopped.string("reason"),
            Some("end-stepping-range" | "function-finished")
        ) && draft_line(stopped.get("frame")).is_none()
        {
            let frames = self.frames(deadline, active)?;
            let command = if frames.is_empty() {
                "-exec-continue"
            } else {
                "-exec-finish"
            };
            stopped = self.execute(command, deadline, active)?;
        }
        self.location(stopped, false, deadline, active)
    }

    pub(super) fn inspect(
        &mut self,
        frame: u32,
        active: &ActiveDebug,
    ) -> Result<DebugFrameVariables> {
        self.variables(frame, Instant::now() + DEBUG_TIMEOUT, active)
    }

    pub(super) fn children(
        &mut self,
        reference: u32,
        active: &ActiveDebug,
    ) -> Result<Vec<DebugVariable>> {
        self.variable_children(reference, Instant::now() + DEBUG_TIMEOUT, active)
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
        deadline: Instant,
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
        let frames = self.frames(deadline, active)?;
        let scope = match frames.first() {
            Some(frame) => self.variables(frame.id, deadline, active)?,
            None => DebugFrameVariables::default(),
        };
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
        self.command(command, deadline, active)?;
        loop {
            let line = self.transport.receive(deadline, active)?;
            if let Some(fields) = line.trim_end().strip_prefix("*stopped") {
                return mi::fields(fields);
            }
        }
    }

    fn command(
        &mut self,
        command: &str,
        deadline: Instant,
        active: &ActiveDebug,
    ) -> Result<mi::Value> {
        let result = self.exchange(command, deadline, active)?;
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
        self.token += 1;
        self.transport
            .send(&format!("{}{command}", self.token), active)?;
        let prefix = format!("{}^", self.token);
        loop {
            let line = self.transport.receive(deadline, active)?;
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

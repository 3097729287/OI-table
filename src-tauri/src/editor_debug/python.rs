use std::{fs, path::Path, time::Instant};

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::editor_run::find_python;

use super::{
    hidden_command, ActiveDebug, DebugAction, DebugError, DebugFrameVariables, DebugLocation,
    DebugPhase, DebugVariable, Result, Transport, DEBUG_TIMEOUT,
};

pub(super) struct Debugger(Transport);

impl Debugger {
    pub(super) fn start(
        root: &Path,
        breakpoints: &[u32],
        active: &ActiveDebug,
    ) -> Result<(Self, DebugLocation)> {
        let python = find_python().ok_or_else(|| {
            DebugError::new("tool_unavailable", "Install Python 3 and add it to PATH.")
        })?;
        fs::write(root.join("debugger.py"), include_str!("python_driver.py"))?;
        let mut command = hidden_command(&python);
        command
            .current_dir(root)
            .args(["-I", "-B", "-u", "-X", "utf8", "debugger.py"]);
        let mut debugger = Self(Transport::spawn(command, Some(root))?);
        let location = debugger.request(
            json!({ "breakpoints": breakpoints }),
            active,
            DebugPhase::ProgramStop,
        )?;
        Ok((debugger, location))
    }

    pub(super) fn step(
        &mut self,
        action: DebugAction,
        breakpoints: &[u32],
        active: &ActiveDebug,
    ) -> Result<DebugLocation> {
        self.request(
            json!({ "action": action, "breakpoints": breakpoints }),
            active,
            DebugPhase::ProgramStop,
        )
    }

    pub(super) fn inspect(
        &mut self,
        frame: u32,
        active: &ActiveDebug,
    ) -> Result<DebugFrameVariables> {
        self.request(json!({ "frame": frame }), active, DebugPhase::Inspection)
    }

    pub(super) fn children(
        &mut self,
        reference: u32,
        active: &ActiveDebug,
    ) -> Result<Vec<DebugVariable>> {
        self.request(
            json!({ "reference": reference }),
            active,
            DebugPhase::Inspection,
        )
    }

    fn request<T: DeserializeOwned>(
        &mut self,
        message: Value,
        active: &ActiveDebug,
        phase: DebugPhase,
    ) -> Result<T> {
        self.0.send(&message.to_string(), active)?;
        let response = self
            .0
            .receive(Instant::now() + DEBUG_TIMEOUT, active, phase)?;
        let json: Value = serde_json::from_str(&response)
            .map_err(|error| DebugError::failed(error.to_string()))?;
        if let Some(message) = json.get("compileError").and_then(Value::as_str) {
            return Err(DebugError::new("compile_failed", message));
        }
        if let Some(message) = json.get("invalidReference").and_then(Value::as_str) {
            return Err(DebugError::invalid(message));
        }
        serde_json::from_value(json).map_err(|error| DebugError::failed(error.to_string()))
    }
}

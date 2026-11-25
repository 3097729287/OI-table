use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    thread,
    time::Instant,
};

use super::super::{
    hidden_command, ActiveDebug, DebugError, DebugPhase, DebugProcess, Result, CANCEL_POLL,
    DEBUG_TIMEOUT,
};

pub(super) struct Inferior {
    process: DebugProcess,
    directory: PathBuf,
}

impl Inferior {
    pub(super) fn start(root: &Path, binary: &str, active: &ActiveDebug) -> Result<Self> {
        active.check_cancelled()?;
        let process = hidden_command(&root.join(binary))
            .current_dir(root)
            .env("OI_TABLE_DEBUG_WAIT", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                DebugError::failed(format!("Could not start the compiled program. {error}"))
            })?;
        let mut inferior = Self {
            process: DebugProcess(process),
            directory: root.to_owned(),
        };
        let ready = root.join("debug-ready");
        let deadline = Instant::now() + DEBUG_TIMEOUT;
        loop {
            active.check_cancelled()?;
            if let Some(status) = inferior.process.0.try_wait()? {
                return Err(DebugError::failed(format!(
                    "The compiled program exited before GDB attached ({status})."
                )));
            }
            if ready.is_file() {
                return Ok(inferior);
            }
            if Instant::now() >= deadline {
                let phase = DebugPhase::ProgramStart;
                return Err(DebugError::timeout(phase, phase.timeout_message()));
            }
            thread::sleep(CANCEL_POLL);
        }
    }

    pub(super) fn id(&self) -> u32 {
        self.process.0.id()
    }

    pub(super) fn release(&self) -> Result<()> {
        fs::write(self.directory.join("debug-start"), b"")?;
        Ok(())
    }
}

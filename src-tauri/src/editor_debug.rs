use std::{
    fs,
    io::{self, BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc, Mutex, TryLockError,
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use crate::editor_run::{hidden_command, stop_child, EditorLanguage};

mod cpp;
mod python;
mod variable_history;

const MAX_DRAFT_BYTES: usize = 256 * 1024;
const MAX_OUTPUT_BYTES: u64 = 256 * 1024;
const MAX_PROTOCOL_BYTES: u64 = 512 * 1024;
const MAX_BREAKPOINTS: usize = 256;
const DEBUG_TIMEOUT: Duration = Duration::from_secs(10);
const COMPILE_TIMEOUT: Duration = Duration::from_secs(15);
const CANCEL_POLL: Duration = Duration::from_millis(50);

type Result<T> = std::result::Result<T, DebugError>;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DebugPhase {
    Compile,
    ProgramStart,
    DebuggerReply,
    ProgramStop,
    Inspection,
}

impl DebugPhase {
    fn timeout_message(self) -> &'static str {
        match self {
            Self::Compile => "Compiling the C++ draft exceeded its time limit.",
            Self::ProgramStart => "The debug program did not finish starting in time.",
            Self::DebuggerReply => "The debugger did not respond in time.",
            Self::ProgramStop => {
                "The program did not reach a breakpoint or exit within the time limit."
            }
            Self::Inspection => "Reading the call stack or variables exceeded its time limit.",
        }
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct DebugError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) phase: Option<DebugPhase>,
}

impl DebugError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            phase: None,
        }
    }

    fn timeout(phase: DebugPhase, message: impl Into<String>) -> Self {
        Self {
            phase: Some(phase),
            ..Self::new("debug_timeout", message)
        }
    }

    fn with_phase(mut self, phase: DebugPhase) -> Self {
        if self.code == "debug_timeout" {
            self.phase = Some(phase);
        }
        self
    }

    fn failed(message: impl Into<String>) -> Self {
        Self::new("debug_failed", message)
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_request", message)
    }

    fn busy() -> Self {
        Self::new("debug_busy", "Another debug operation is active.")
    }

    fn cancelled() -> Self {
        Self::new("debug_cancelled", "The debug session was stopped.")
    }
}

impl From<io::Error> for DebugError {
    fn from(error: io::Error) -> Self {
        Self::failed(error.to_string())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugStartRequest {
    session_id: u64,
    language: EditorLanguage,
    source: String,
    stdin: String,
    breakpoints: Vec<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugStepRequest {
    session_id: u64,
    action: DebugAction,
    breakpoints: Vec<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugInspectRequest {
    session_id: u64,
    frame_id: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugVariablesRequest {
    session_id: u64,
    reference: u32,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum DebugAction {
    Continue,
    StepOver,
    StepInto,
    StepOut,
}

#[derive(Clone, Deserialize, Serialize)]
struct DebugFrame {
    id: u32,
    name: String,
    line: u32,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct DebugVariable {
    name: String,
    value: String,
    r#type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reference: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    group: Option<DebugVariableGroup>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    previous: Option<DebugVariableValue>,
}

#[derive(Clone, Deserialize, Serialize)]
struct DebugVariableValue {
    value: String,
    r#type: String,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum DebugVariableGroup {
    Special,
    Function,
    Class,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugFrameVariables {
    variables: Vec<DebugVariable>,
    globals_reference: Option<u32>,
}

#[derive(Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
enum DebugStatus {
    Paused,
    Finished,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum DebugReason {
    Entry,
    Breakpoint,
    Step,
    Exception,
    Signal,
    Exited,
}

#[derive(Deserialize, Serialize)]
struct DebugLocation {
    status: DebugStatus,
    reason: DebugReason,
    line: Option<u32>,
    frames: Vec<DebugFrame>,
    #[serde(flatten)]
    scope: DebugFrameVariables,
}

impl DebugLocation {
    fn finished(reason: DebugReason) -> Self {
        Self {
            status: DebugStatus::Finished,
            reason,
            line: None,
            frames: Vec::new(),
            scope: DebugFrameVariables::default(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DebugSnapshot {
    session_id: u64,
    #[serde(flatten)]
    location: DebugLocation,
    stdout: String,
    stderr: String,
}

#[derive(Clone, Default)]
pub(crate) struct EditorDebugState {
    active: Arc<Mutex<Option<Arc<ActiveDebug>>>>,
    cpp: Arc<cpp::Pool>,
}

impl EditorDebugState {
    fn reserve(&self, id: u64) -> Result<Arc<ActiveDebug>> {
        let mut slot = self
            .active
            .lock()
            .map_err(|_| DebugError::failed("The debugger state is unavailable."))?;
        if slot.is_some() {
            return Err(DebugError::busy());
        }
        let active = Arc::new(ActiveDebug {
            id,
            cancelled: AtomicBool::new(false),
            session: Mutex::new(None),
        });
        *slot = Some(Arc::clone(&active));
        Ok(active)
    }

    pub(crate) fn cancel_all(&self) {
        self.cpp.close();
        let detached = self.active.lock().ok().and_then(|mut slot| slot.take());
        if let Some(active) = detached {
            stop_active(&active, None);
        }
    }
}

#[derive(Default)]
struct ActiveDebug {
    id: u64,
    cancelled: AtomicBool,
    session: Mutex<Option<DebugSession>>,
}

fn stop_active(active: &ActiveDebug, pool: Option<&cpp::Pool>) {
    active.cancel();
    // Active operations wake when they observe cancellation and release the transport.
    if let Ok(mut stored) = active.session.lock() {
        let session = stored.take();
        if let (Some(session), Some(pool)) = (session, pool) {
            session.recycle(pool, true);
        }
    }
}

impl ActiveDebug {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    fn check_cancelled(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err(DebugError::cancelled());
        }
        Ok(())
    }

    fn lock_session(&self) -> Result<std::sync::MutexGuard<'_, Option<DebugSession>>> {
        self.session.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => DebugError::busy(),
            TryLockError::Poisoned(_) => DebugError::failed("The debugger state is unavailable."),
        })
    }
}

fn cleanup(slot: &Mutex<Option<Arc<ActiveDebug>>>, active: &Arc<ActiveDebug>) {
    if let Ok(mut slot) = slot.lock() {
        if slot
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, active))
        {
            slot.take();
        }
    }
}

fn get_active(state: &EditorDebugState, id: u64) -> Result<Arc<ActiveDebug>> {
    state
        .active
        .lock()
        .map_err(|_| DebugError::failed("The debugger state is unavailable."))?
        .as_ref()
        .filter(|active| active.id == id)
        .cloned()
        .ok_or_else(DebugError::cancelled)
}

#[tauri::command]
pub(crate) async fn warm_cpp_debugger(state: tauri::State<'_, EditorDebugState>) -> Result<()> {
    if cfg!(desktop) {
        let state = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            if state.active.lock().is_ok_and(|slot| slot.is_none()) {
                state.cpp.warm();
            }
        })
        .await
        .map_err(|error| DebugError::failed(error.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn debug_start(
    state: tauri::State<'_, EditorDebugState>,
    mut request: DebugStartRequest,
) -> Result<DebugSnapshot> {
    if !cfg!(desktop) {
        return Err(DebugError::new(
            "tool_unavailable",
            "Debugging is available on desktop.",
        ));
    }
    if request.session_id == 0
        || request.session_id > 9_007_199_254_740_991
        || request.source.len() > MAX_DRAFT_BYTES
        || request.stdin.len() > MAX_DRAFT_BYTES
    {
        return Err(DebugError::invalid(
            "Debug sessions accept up to 256 KiB each of source and input.",
        ));
    }
    normalize_breakpoints(&mut request.breakpoints)?;
    let slot = Arc::clone(&state.active);
    let pool = Arc::clone(&state.cpp);
    let active = state.reserve(request.session_id)?;

    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let mut stored = active.lock_session()?;
            let (session, snapshot) = DebugSession::start(request, &active, &pool)?;
            active.check_cancelled()?;
            if snapshot.location.status == DebugStatus::Paused {
                stored.replace(session);
            } else {
                session.recycle(&pool, false);
            }
            Ok(snapshot)
        })();
        if !matches!(&result, Ok(snapshot) if snapshot.location.status == DebugStatus::Paused) {
            cleanup(&slot, &active);
        }
        result
    })
    .await
    .map_err(|error| DebugError::failed(error.to_string()))?
}

pub(crate) fn verify_debug_fixture(
    state: &EditorDebugState,
    language: EditorLanguage,
    source: &str,
    input: &str,
    breakpoint: u32,
    expected: &str,
) -> Result<()> {
    // Editor sessions use positive IDs. This reservation keeps diagnostics
    // from starting a second debugger while an editor owns the active slot.
    let active = state.reserve(0)?;
    let result = (|| {
        let _running = active.lock_session()?;
        let (mut session, paused) = DebugSession::start(
            DebugStartRequest {
                session_id: active.id,
                language,
                source: source.into(),
                stdin: input.into(),
                breakpoints: vec![breakpoint],
            },
            &active,
            &state.cpp,
        )?;
        if paused.location.status == DebugStatus::Finished {
            return Err(DebugError::failed(
                "The debugger sample exited before reaching the expected breakpoint.",
            ));
        }
        if paused.location.line != Some(breakpoint)
            || !matches!(paused.location.reason, DebugReason::Breakpoint)
            || paused.location.frames.len() < 2
            || !paused
                .location
                .scope
                .variables
                .iter()
                .any(|variable| variable.name == "result" && variable.value == expected)
        {
            return Err(DebugError::failed(
                "The debugger did not stop at the expected breakpoint with the sample variable and call stack.",
            ));
        }
        let done = session.step(
            &DebugStepRequest {
                session_id: active.id,
                action: DebugAction::Continue,
                breakpoints: vec![],
            },
            &active,
        )?;
        if !matches!(done.location.reason, DebugReason::Exited) || done.stdout.trim() != expected {
            return Err(DebugError::failed(if done.stderr.trim().is_empty() {
                "The debugger sample did not finish with the expected output.".into()
            } else {
                done.stderr
            }));
        }
        session.recycle(&state.cpp, false);
        Ok(())
    })();
    cleanup(&state.active, &active);
    result
}

#[tauri::command]
pub(crate) async fn debug_step(
    state: tauri::State<'_, EditorDebugState>,
    mut request: DebugStepRequest,
) -> Result<DebugSnapshot> {
    normalize_breakpoints(&mut request.breakpoints)?;
    let active = get_active(&state, request.session_id)?;
    let slot = Arc::clone(&state.active);
    let pool = Arc::clone(&state.cpp);
    tauri::async_runtime::spawn_blocking(move || {
        let mut stored = active.lock_session()?;
        let session = stored.as_mut().ok_or_else(DebugError::busy)?;
        let result = session.step(&request, &active);
        if !matches!(&result, Ok(snapshot) if snapshot.location.status == DebugStatus::Paused) {
            let session = stored.take();
            if let (Ok(_), Some(session)) = (&result, session) {
                session.recycle(&pool, false);
            }
            cleanup(&slot, &active);
        }
        result
    })
    .await
    .map_err(|error| DebugError::failed(error.to_string()))?
}

#[tauri::command]
pub(crate) async fn debug_inspect(
    state: tauri::State<'_, EditorDebugState>,
    request: DebugInspectRequest,
) -> Result<DebugFrameVariables> {
    load_variables(&state, request.session_id, move |session, active| {
        session.inspect(request.frame_id, active)
    })
    .await
}

#[tauri::command]
pub(crate) async fn debug_variables(
    state: tauri::State<'_, EditorDebugState>,
    request: DebugVariablesRequest,
) -> Result<Vec<DebugVariable>> {
    load_variables(&state, request.session_id, move |session, active| {
        session.children(request.reference, active)
    })
    .await
}

async fn load_variables<T: Send + 'static>(
    state: &EditorDebugState,
    session_id: u64,
    load: impl FnOnce(&mut DebugSession, &ActiveDebug) -> Result<T> + Send + 'static,
) -> Result<T> {
    let active = get_active(state, session_id)?;
    let slot = Arc::clone(&state.active);
    tauri::async_runtime::spawn_blocking(move || {
        let mut stored = active.lock_session()?;
        let session = stored.as_mut().ok_or_else(DebugError::busy)?;
        let result = load(session, &active);
        if result
            .as_ref()
            .is_err_and(|error| !matches!(error.code, "invalid_request" | "debug_busy"))
        {
            cleanup(&slot, &active);
            stored.take();
        }
        result
    })
    .await
    .map_err(|error| DebugError::failed(error.to_string()))?
}

#[tauri::command]
pub(crate) async fn debug_stop(
    state: tauri::State<'_, EditorDebugState>,
    session_id: u64,
) -> Result<()> {
    let detached = {
        let mut slot = state
            .active
            .lock()
            .map_err(|_| DebugError::failed("The debugger state is unavailable."))?;
        if let Some(active) = slot.as_ref().filter(|active| active.id == session_id) {
            active.cancel();
            slot.take()
        } else {
            None
        }
    };
    let pool = Arc::clone(&state.cpp);
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(active) = detached {
            stop_active(&active, Some(&pool));
        }
    })
    .await
    .map_err(|error| DebugError::failed(error.to_string()))?;
    Ok(())
}

fn normalize_breakpoints(breakpoints: &mut Vec<u32>) -> Result<()> {
    if breakpoints.len() > MAX_BREAKPOINTS || breakpoints.contains(&0) {
        return Err(DebugError::invalid(
            "Debug sessions support up to 256 positive breakpoint lines.",
        ));
    }
    breakpoints.sort_unstable();
    breakpoints.dedup();
    Ok(())
}

enum Engine {
    Cpp(cpp::Debugger),
    Python(python::Debugger),
}

impl Engine {
    fn children(&mut self, reference: u32, active: &ActiveDebug) -> Result<Vec<DebugVariable>> {
        match self {
            Self::Cpp(engine) => engine.children(reference, active),
            Self::Python(engine) => engine.children(reference, active),
        }
    }
}

struct DebugSession {
    engine: Engine,
    frames: Vec<DebugFrame>,
    variable_history: variable_history::VariableHistory,
    directory: tempfile::TempDir,
}

impl DebugSession {
    fn start(
        request: DebugStartRequest,
        active: &ActiveDebug,
        pool: &cpp::Pool,
    ) -> Result<(Self, DebugSnapshot)> {
        active.check_cancelled()?;
        let directory = tempfile::tempdir()?;
        let root = directory.path();
        fs::write(root.join("input.txt"), request.stdin)?;
        let (engine, location) = match request.language {
            EditorLanguage::Cpp => {
                fs::write(root.join("solution.cpp"), request.source)?;
                let (engine, location) =
                    cpp::Debugger::start(root, &request.breakpoints, active, pool)?;
                (Engine::Cpp(engine), location)
            }
            EditorLanguage::Python => {
                fs::write(root.join("solution.py"), request.source)?;
                let (engine, location) =
                    python::Debugger::start(root, &request.breakpoints, active)?;
                (Engine::Python(engine), location)
            }
        };
        let mut session = Self {
            engine,
            frames: Vec::new(),
            variable_history: variable_history::VariableHistory::default(),
            directory,
        };
        let snapshot = session.snapshot(request.session_id, location);
        Ok((session, snapshot))
    }

    fn recycle(self, pool: &cpp::Pool, paused: bool) {
        if let Engine::Cpp(debugger) = self.engine {
            pool.recycle(debugger, paused);
        }
    }

    fn snapshot(&mut self, session_id: u64, mut location: DebugLocation) -> DebugSnapshot {
        self.frames = location.frames.clone();
        self.variable_history.show(
            self.frames.iter().map(|frame| frame.name.clone()).collect(),
            &mut location.scope,
        );
        DebugSnapshot {
            session_id,
            location,
            stdout: read_output(&self.directory.path().join("output.txt")),
            stderr: read_output(&self.directory.path().join("error.txt")),
        }
    }

    fn step(&mut self, request: &DebugStepRequest, active: &ActiveDebug) -> Result<DebugSnapshot> {
        active.check_cancelled()?;
        self.variable_history
            .remember(|reference| self.engine.children(reference, active))?;
        let location = match &mut self.engine {
            Engine::Cpp(engine) => engine.step(request.action, &request.breakpoints, active)?,
            Engine::Python(engine) => engine.step(request.action, &request.breakpoints, active)?,
        };
        active.check_cancelled()?;
        Ok(self.snapshot(request.session_id, location))
    }

    fn inspect(&mut self, frame: u32, active: &ActiveDebug) -> Result<DebugFrameVariables> {
        active.check_cancelled()?;
        let Some(index) = self
            .frames
            .iter()
            .position(|candidate| candidate.id == frame)
        else {
            return Err(DebugError::invalid(
                "The requested stack frame is unavailable.",
            ));
        };
        let mut scope = match &mut self.engine {
            Engine::Cpp(engine) => engine.inspect(frame, active),
            Engine::Python(engine) => engine.inspect(frame, active),
        }?;
        self.variable_history.show(
            self.frames[index..]
                .iter()
                .map(|frame| frame.name.clone())
                .collect(),
            &mut scope,
        );
        Ok(scope)
    }

    fn children(&mut self, reference: u32, active: &ActiveDebug) -> Result<Vec<DebugVariable>> {
        active.check_cancelled()?;
        let mut children = self.engine.children(reference, active)?;
        self.variable_history
            .compare_children(reference, &mut children);
        Ok(children)
    }
}

fn read_output(path: &Path) -> String {
    let mut bytes = Vec::new();
    if let Ok(file) = fs::File::open(path) {
        let _ = file.take(MAX_OUTPUT_BYTES).read_to_end(&mut bytes);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

struct DebugProcess(Child);

impl Drop for DebugProcess {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            stop_child(&mut self.0);
        }
    }
}

struct Transport {
    input: ChildStdin,
    output: Receiver<io::Result<String>>,
    directory: Option<PathBuf>,
    _process: DebugProcess,
}

impl Transport {
    fn spawn(mut command: Command, directory: Option<&Path>) -> Result<Self> {
        let mut process = DebugProcess(
            command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()?,
        );
        let input = process
            .0
            .stdin
            .take()
            .ok_or_else(|| DebugError::failed("Debugger input is unavailable."))?;
        let output = process
            .0
            .stdout
            .take()
            .ok_or_else(|| DebugError::failed("Debugger output is unavailable."))?;
        let (sender, output_pipe) = mpsc::sync_channel(128);
        thread::spawn(move || {
            let mut output = BufReader::new(output);
            loop {
                let mut line = Vec::new();
                match output
                    .by_ref()
                    .take(MAX_PROTOCOL_BYTES + 1)
                    .read_until(b'\n', &mut line)
                {
                    Ok(0) => break,
                    Ok(_) if line.len() as u64 <= MAX_PROTOCOL_BYTES => {
                        if sender
                            .send(Ok(String::from_utf8_lossy(&line).into_owned()))
                            .is_err()
                        {
                            break;
                        }
                    }
                    Ok(_) => {
                        let _ = sender.send(Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "Debugger response is too large.",
                        )));
                        break;
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error));
                        break;
                    }
                }
            }
        });
        Ok(Self {
            input,
            output: output_pipe,
            directory: directory.map(Path::to_owned),
            _process: process,
        })
    }

    fn send(&mut self, line: &str, active: &ActiveDebug) -> Result<()> {
        active.check_cancelled()?;
        writeln!(self.input, "{line}")?;
        self.input.flush()?;
        Ok(())
    }

    fn receive(
        &self,
        deadline: Instant,
        active: &ActiveDebug,
        phase: DebugPhase,
    ) -> Result<String> {
        loop {
            active.check_cancelled()?;
            if let Some(directory) = &self.directory {
                check_output_size(directory)?;
            }
            if Instant::now() >= deadline {
                return Err(DebugError::timeout(phase, phase.timeout_message()));
            }
            match self.output.recv_timeout(CANCEL_POLL) {
                Ok(result) => {
                    if let Some(directory) = &self.directory {
                        check_output_size(directory)?;
                    }
                    return Ok(result?);
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(DebugError::failed("The debugger exited unexpectedly."))
                }
            }
        }
    }
}

fn check_output_size(root: &Path) -> Result<()> {
    for file in ["output.txt", "error.txt"] {
        if root
            .join(file)
            .metadata()
            .is_ok_and(|metadata| metadata.len() > MAX_OUTPUT_BYTES)
        {
            return Err(DebugError::new(
                "output_limit",
                "Program output exceeded the debug limit.",
            ));
        }
    }
    Ok(())
}

fn compile_cpp(compiler: &Path, root: &Path, binary: &str, active: &ActiveDebug) -> Result<()> {
    fs::write(
        root.join("debug_streams.cpp"),
        include_str!("editor_debug/cpp_streams.cpp"),
    )?;
    let diagnostics = root.join("compiler.txt");
    let stderr = fs::File::create(&diagnostics)?;
    let mut process = DebugProcess(
        hidden_command(compiler)
            .current_dir(root)
            .args([
                "-std=gnu++17",
                "-g",
                "-O0",
                "debug_streams.cpp",
                "solution.cpp",
                "-o",
                binary,
            ])
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(stderr)
            .spawn()?,
    );
    let deadline = Instant::now() + COMPILE_TIMEOUT;
    loop {
        active.check_cancelled()?;
        if let Some(status) = process.0.try_wait()? {
            if status.success() {
                return Ok(());
            }
            let message = read_output(&diagnostics);
            return Err(DebugError::new(
                "compile_failed",
                if message.is_empty() {
                    "The C++ draft could not be compiled.".into()
                } else {
                    message
                },
            ));
        }
        if Instant::now() >= deadline {
            return Err(DebugError::timeout(
                DebugPhase::Compile,
                DebugPhase::Compile.timeout_message(),
            ));
        }
        thread::sleep(CANCEL_POLL);
    }
}

#[cfg(test)]
mod tests {
    use crate::editor_run::{find_cpp, find_program, find_python};

    use super::*;

    static GDB_TEST: Mutex<()> = Mutex::new(());

    #[test]
    fn diagnostic_fixture_does_not_replace_an_editor_debug_session() {
        let state = EditorDebugState::default();
        let original = state.reserve(1).unwrap();
        let result = verify_debug_fixture(&state, EditorLanguage::Python, "", "", 1, "42");
        assert_eq!(result.unwrap_err().code, "debug_busy");
        assert!(Arc::ptr_eq(&get_active(&state, 1).unwrap(), &original));
    }

    fn active() -> ActiveDebug {
        ActiveDebug {
            id: 1,
            cancelled: AtomicBool::new(false),
            session: Mutex::new(None),
        }
    }

    fn start_session(
        request: DebugStartRequest,
        active: &ActiveDebug,
    ) -> Result<(DebugSession, DebugSnapshot)> {
        DebugSession::start(request, active, &cpp::Pool::default())
    }

    fn request(language: EditorLanguage, source: &str, breakpoints: &[u32]) -> DebugStartRequest {
        DebugStartRequest {
            session_id: 1,
            language,
            source: source.into(),
            stdin: "17\n".into(),
            breakpoints: breakpoints.into(),
        }
    }

    fn variable_reference(variables: &[DebugVariable], name: &str) -> u32 {
        variables
            .iter()
            .find(|variable| variable.name == name)
            .and_then(|variable| variable.reference)
            .unwrap()
    }

    fn check_previously_unopened_variables(
        language: EditorLanguage,
        source: &str,
        pause_line: u32,
    ) {
        let active = active();
        let (mut session, paused) =
            start_session(request(language, source, &[pause_line]), &active).unwrap();
        assert_eq!(paused.location.line, Some(pause_line));
        let snapshot = session
            .step(
                &DebugStepRequest {
                    session_id: active.id,
                    action: DebugAction::StepOver,
                    breakpoints: vec![],
                },
                &active,
            )
            .unwrap();
        assert_eq!(snapshot.location.line, Some(pause_line + 1));
        let scope = snapshot.location.scope;
        let item = session
            .children(variable_reference(&scope.variables, "item"), &active)
            .unwrap();
        let children = session
            .children(variable_reference(&item, "values"), &active)
            .unwrap();
        assert_eq!(children[0].value, "2");
        assert_eq!(
            children[0].previous.as_ref().map(|row| row.value.as_str()),
            Some("1")
        );
        assert!(children[1].previous.is_none());
        let globals = session
            .children(scope.globals_reference.unwrap(), &active)
            .unwrap();
        let shared = session
            .children(variable_reference(&globals, "shared"), &active)
            .unwrap();
        assert_eq!(shared[0].value, "6");
        assert_eq!(
            shared[0].previous.as_ref().map(|row| row.value.as_str()),
            Some("5")
        );
    }

    #[test]
    fn python_compares_children_first_opened_after_stepping() {
        if find_python().is_none() {
            return;
        }
        check_previously_unopened_variables(
            EditorLanguage::Python,
            concat!(
                "class Box: pass\n",
                "shared = [5]\n",
                "def work():\n",
                "    item = Box()\n",
                "    item.values = [1, 3]\n",
                "    item.values[0] = 2; shared[0] = 6\n",
                "    return item\n",
                "work()\n",
            ),
            6,
        );
    }

    #[test]
    #[ignore = "requires an installed GDB and OS permission to debug a child process"]
    fn cpp_compares_children_first_opened_after_stepping() {
        let _gdb = GDB_TEST.lock().unwrap();
        check_previously_unopened_variables(
            EditorLanguage::Cpp,
            concat!(
                "struct Box { int values[2]; };\n",
                "int shared[1] = {5};\n",
                "int main() {\n",
                "    Box item = {{1, 3}};\n",
                "    item.values[0] = 2; shared[0] = 6;\n",
                "    return item.values[0];\n",
                "}\n",
            ),
            5,
        );
    }

    fn inspect_and_run(
        request: DebugStartRequest,
        breakpoint: u32,
        caller_line: u32,
        next_line: u32,
    ) {
        let active = active();
        let (mut session, paused) = start_session(request, &active).unwrap();
        assert!(matches!(paused.location.reason, DebugReason::Breakpoint));
        assert_eq!(paused.location.line, Some(breakpoint));
        let frames = &paused.location.frames;
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].name, "f");
        assert_eq!(frames[1].line, caller_line);
        assert!(paused
            .location
            .scope
            .variables
            .iter()
            .any(|value| { value.name == "y" && value.value == "18" && value.r#type == "int" }));
        let caller = session.inspect(frames[1].id, &active).unwrap();
        assert!(caller
            .variables
            .iter()
            .any(|value| value.name == "n" && value.value == "17"));

        let step = |action| DebugStepRequest {
            session_id: 1,
            action,
            breakpoints: vec![],
        };
        let returned = session.step(&step(DebugAction::StepOut), &active).unwrap();
        assert!(matches!(returned.location.reason, DebugReason::Step));
        assert_eq!(returned.location.line, Some(next_line));
        let done = session.step(&step(DebugAction::Continue), &active).unwrap();
        assert!(matches!(done.location.status, DebugStatus::Finished));
        assert!(matches!(done.location.reason, DebugReason::Exited));
        assert_eq!(done.stdout.trim(), "36");
    }

    #[test]
    fn python_breakpoints_variables_frames_and_input() {
        if find_python().is_none() {
            return;
        }
        let source =
            "def f(x):\n    y = x + 1\n    return y * 2\n\nn = int(input())\nr = f(n)\nprint(r)\n";
        inspect_and_run(request(EditorLanguage::Python, source, &[3]), 3, 6, 7);
    }

    #[test]
    fn python_expands_nested_rows_and_expires_references_after_stepping() {
        if find_python().is_none() {
            return;
        }
        let active = active();
        let source = "rows = [{'details': (7, 11)}]\nprint(rows)\nrows.append({})\n";
        let (mut session, paused) =
            start_session(request(EditorLanguage::Python, source, &[2]), &active).unwrap();
        let rows = variable_reference(&paused.location.scope.variables, "rows");
        let nested = session.children(rows, &active).unwrap();
        let dictionary = variable_reference(&nested, "[0]");
        let fields = session.children(dictionary, &active).unwrap();
        let tuple = variable_reference(&fields, "['details']");
        let details = session.children(tuple, &active).unwrap();
        assert!(details
            .iter()
            .any(|detail| detail.name == "[1]" && detail.value == "11"));

        let stepped = session
            .step(
                &DebugStepRequest {
                    session_id: 1,
                    action: DebugAction::StepOver,
                    breakpoints: vec![],
                },
                &active,
            )
            .unwrap();
        assert_ne!(
            variable_reference(&stepped.location.scope.variables, "rows"),
            rows
        );
        assert_eq!(
            session.children(rows, &active).err().unwrap().code,
            "invalid_request"
        );
    }

    #[test]
    fn python_separates_function_locals_from_module_globals() {
        if find_python().is_none() {
            return;
        }
        let active = active();
        let source = "shared = [2, 3]\ndef f(x):\n    y = x + 1\n    return y\nf(7)\n";
        let (mut session, paused) =
            start_session(request(EditorLanguage::Python, source, &[4]), &active).unwrap();
        let locals = &paused.location.scope.variables;
        assert!(locals
            .iter()
            .any(|variable| variable.name == "y" && variable.value == "8"));
        assert!(!locals.iter().any(|variable| variable.name == "shared"));
        let globals_reference = paused.location.scope.globals_reference.unwrap();
        let globals = session.children(globals_reference, &active).unwrap();
        assert!(globals.iter().any(|variable| {
            variable.name == "f" && matches!(variable.group, Some(DebugVariableGroup::Function))
        }));
        assert!(globals
            .iter()
            .any(|variable| variable.name == "shared" && variable.reference.is_some()));
        let caller = session
            .inspect(paused.location.frames[1].id, &active)
            .unwrap();
        assert_eq!(caller.globals_reference, Some(globals_reference));
    }

    #[test]
    #[ignore = "requires an installed GDB and OS permission to debug a child process"]
    fn cpp_breakpoints_variables_frames_and_input() {
        let _gdb = GDB_TEST.lock().unwrap();
        assert!(find_cpp().is_some() && find_program("gdb").is_some());
        let source = concat!(
            "#include <iostream>\n",
            "int f(int x) {\n",
            "    int y = x + 1;\n",
            "    return y * 2;\n",
            "}\n",
            "int main() {\n",
            "    std::ios::sync_with_stdio(false);\n",
            "    int n; std::cin >> n;\n",
            "    int r = f(n);\n",
            "    std::cout << r << '\\n';\n",
            "}\n",
        );
        inspect_and_run(request(EditorLanguage::Cpp, source, &[4]), 4, 9, 9);
    }

    #[test]
    #[ignore = "requires an installed GDB and OS permission to debug a child process"]
    fn reuses_warmed_gdb_across_cpp_debug_sessions() {
        let _gdb = GDB_TEST.lock().unwrap();
        let pool = cpp::Pool::default();
        pool.warm();
        let pid = pool.idle_pid().expect("GDB warmed up");
        let first_active = active();
        let first = "int main() {\n    int value = 1;\n    return value;\n}\n";
        let (session, paused) = DebugSession::start(
            request(EditorLanguage::Cpp, first, &[3]),
            &first_active,
            &pool,
        )
        .unwrap();
        assert_eq!(paused.location.line, Some(3));
        let directory = session.directory.path().to_path_buf();
        first_active.session.lock().unwrap().replace(session);
        stop_active(&first_active, Some(&pool));
        assert!(!directory.exists());
        assert_eq!(pool.idle_pid(), Some(pid));

        let active = active();
        let invalid = request(EditorLanguage::Cpp, "this is not valid C++", &[]);
        assert!(
            matches!(DebugSession::start(invalid, &active, &pool), Err(error) if error.code == "compile_failed")
        );
        assert_eq!(pool.idle_pid(), Some(pid));

        let second =
            "#include <cstdio>\nint main() {\n    std::puts(\"fresh\");\n    return 0;\n}\n";
        let (mut session, paused) =
            DebugSession::start(request(EditorLanguage::Cpp, second, &[4]), &active, &pool)
                .unwrap();
        assert_eq!(paused.location.line, Some(4));
        assert_eq!(paused.stdout.trim(), "fresh");
        let done = session
            .step(
                &DebugStepRequest {
                    session_id: active.id,
                    action: DebugAction::Continue,
                    breakpoints: vec![],
                },
                &active,
            )
            .unwrap();
        assert!(done.location.status == DebugStatus::Finished);
        session.recycle(&pool, false);
        assert_eq!(pool.idle_pid(), Some(pid));
        pool.close();
        assert!(pool.idle_pid().is_none());
    }

    #[test]
    #[ignore = "requires an installed GDB and OS permission to debug a child process"]
    fn cpp_expands_draft_globals_nested_fields_array_and_vector() {
        let _gdb = GDB_TEST.lock().unwrap();
        assert!(find_cpp().is_some() && find_program("gdb").is_some());
        let source = concat!(
            "#include <vector>\n",
            "struct Item { int score; int levels[2]; std::vector<int> nums; };\n",
            "int score = 42;\n",
            "static int values[2] = {17, 19};\n",
            "namespace draft { int counter = 5; }\n",
            "int main() {\n",
            "    Item item;\n",
            "    int score = 7;\n",
            "    item.score = score;\n",
            "    item.levels[0] = 3;\n",
            "    item.levels[1] = 5;\n",
            "    item.nums.push_back(11);\n",
            "    item.nums.push_back(13);\n",
            "    int marker = item.score + values[0];\n",
            "    ++::score;\n",
            "    return marker;\n",
            "}\n",
        );
        let active = active();
        let (mut session, paused) =
            start_session(request(EditorLanguage::Cpp, source, &[14]), &active).unwrap();
        let item = variable_reference(&paused.location.scope.variables, "item");
        assert!(paused
            .location
            .scope
            .variables
            .iter()
            .any(|value| value.name == "score" && value.value == "7"));
        let globals_reference = paused.location.scope.globals_reference.unwrap();
        let globals = session.children(globals_reference, &active).unwrap();
        assert_eq!(globals.len(), 3);
        assert!(globals
            .iter()
            .any(|value| value.name == "score" && value.value == "42"));
        assert!(globals
            .iter()
            .any(|value| value.name == "draft::counter" && value.value == "5"));
        let values = session
            .children(variable_reference(&globals, "values"), &active)
            .unwrap();
        assert!(values
            .iter()
            .any(|value| value.name == "[0]" && value.value == "17"));
        let same_frame = session
            .inspect(paused.location.frames[0].id, &active)
            .unwrap();
        assert_eq!(variable_reference(&same_frame.variables, "item"), item);
        let fields = session.children(item, &active).unwrap();
        assert!(fields
            .iter()
            .any(|field| field.name == "score" && field.value == "7"));
        let levels = session
            .children(variable_reference(&fields, "levels"), &active)
            .unwrap();
        assert_eq!(
            levels
                .iter()
                .map(|level| (level.name.as_str(), level.value.as_str()))
                .collect::<Vec<_>>(),
            vec![("[0]", "3"), ("[1]", "5")]
        );
        let nums = session
            .children(variable_reference(&fields, "nums"), &active)
            .unwrap();
        assert_eq!(
            nums.iter()
                .map(|number| (number.name.as_str(), number.value.as_str()))
                .collect::<Vec<_>>(),
            vec![("[0]", "11"), ("[1]", "13")]
        );

        session
            .step(
                &DebugStepRequest {
                    session_id: 1,
                    action: DebugAction::StepOver,
                    breakpoints: vec![14],
                },
                &active,
            )
            .unwrap();
        assert_eq!(
            session.children(item, &active).err().unwrap().code,
            "invalid_request"
        );
        assert_eq!(
            session
                .children(globals_reference, &active)
                .err()
                .unwrap()
                .code,
            "invalid_request"
        );
    }

    #[test]
    fn python_debug_stops_on_large_output() {
        if find_python().is_none() {
            return;
        }
        let active = active();
        let source = "for i in range(10000):\n    print('s' * 1024)\n";
        let (mut session, paused) =
            start_session(request(EditorLanguage::Python, source, &[]), &active).unwrap();
        assert!(matches!(paused.location.reason, DebugReason::Entry));
        let error = session
            .step(
                &DebugStepRequest {
                    session_id: 1,
                    action: DebugAction::Continue,
                    breakpoints: vec![],
                },
                &active,
            )
            .err()
            .unwrap();
        assert_eq!(error.code, "output_limit");
    }

    #[test]
    fn python_debug_can_cancel_while_program_is_running() {
        if find_python().is_none() {
            return;
        }
        let active = Arc::new(active());
        let worker_state = Arc::clone(&active);
        let (running, started) = mpsc::channel();
        let worker = thread::spawn(move || {
            let source = "while True:\n    pass\n";
            let (mut session, _) =
                start_session(request(EditorLanguage::Python, source, &[]), &worker_state).unwrap();
            running.send(()).unwrap();
            session
                .step(
                    &DebugStepRequest {
                        session_id: 1,
                        action: DebugAction::Continue,
                        breakpoints: vec![],
                    },
                    &worker_state,
                )
                .err()
                .unwrap()
        });
        started.recv_timeout(DEBUG_TIMEOUT).unwrap();
        thread::sleep(CANCEL_POLL * 2);
        stop_active(&active, None);
        assert_eq!(worker.join().unwrap().code, "debug_cancelled");
    }
}

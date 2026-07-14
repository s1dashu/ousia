use chrono::Utc;
use serde_json::{Map, Value, json};
use std::{
    collections::HashMap,
    io::ErrorKind,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    time::Instant,
};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex as AsyncMutex, oneshot},
    time::{Duration, sleep, timeout},
};

use crate::{
    logging::RuntimeLogger,
    paths::ShellEnvironment,
    runtime::PiRuntimeManager,
    state::{ChatContext, SessionMapping, SessionStore},
};

const MAX_RPC_LINE_BYTES: usize = 32 * 1024 * 1024;
const RPC_TIMEOUT: Duration = Duration::from_secs(600);
const LEGACY_AGENT_SETTLE_GRACE: Duration = Duration::from_millis(250);
const SESSION_MAPPING_POLL_INTERVAL: Duration = Duration::from_millis(50);

type PendingResponse = oneshot::Sender<Result<Value, String>>;

fn session_file_is_materialized(path: &Path) -> Result<bool, String> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(true),
        Ok(_) => Err(format!(
            "Pi session path is not a regular file: {}",
            path.display()
        )),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Failed to inspect Pi session file {}: {error}",
            path.display()
        )),
    }
}

#[derive(Debug, Default)]
struct AssistantStreamState {
    active_message_sequence: Option<u64>,
    next_message_sequence: u64,
    streamed_tool_calls: HashMap<u64, StreamedToolCallState>,
    tool_input_scans: HashMap<u64, ToolInputScanState>,
}

#[derive(Debug)]
struct StreamedToolCallState {
    id: String,
    input_complete: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ToolInputCompletionSource {
    Json,
    ToolcallEnd,
}

impl ToolInputCompletionSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::ToolcallEnd => "toolcall_end",
        }
    }
}

#[derive(Debug, Default)]
struct ToolInputScanState {
    delta_count: u64,
    escaped: bool,
    expected_closers: Vec<char>,
    in_string: bool,
    invalid: bool,
    parse_attempted: bool,
    raw_arguments: String,
    root_closed: bool,
    root_started: bool,
    strictly_complete: bool,
}

impl ToolInputScanState {
    fn append(&mut self, delta: &str) -> Result<(), String> {
        self.delta_count = self
            .delta_count
            .checked_add(1)
            .ok_or_else(|| "Pi tool-input delta count overflowed.".to_string())?;
        self.raw_arguments.push_str(delta);

        for character in delta.chars() {
            if self.invalid {
                continue;
            }
            if self.root_closed {
                if !is_json_whitespace(character) {
                    self.invalid = true;
                    self.strictly_complete = false;
                }
                continue;
            }
            if !self.root_started {
                if is_json_whitespace(character) {
                    continue;
                }
                if character != '{' {
                    self.invalid = true;
                    self.strictly_complete = false;
                    continue;
                }
                self.root_started = true;
                self.expected_closers.push('}');
                continue;
            }
            if self.in_string {
                if self.escaped {
                    self.escaped = false;
                } else if character == '\\' {
                    self.escaped = true;
                } else if character == '"' {
                    self.in_string = false;
                }
                continue;
            }
            match character {
                '"' => self.in_string = true,
                '{' => self.expected_closers.push('}'),
                '[' => self.expected_closers.push(']'),
                '}' | ']' => {
                    if self.expected_closers.last() != Some(&character) {
                        self.invalid = true;
                        self.strictly_complete = false;
                        continue;
                    }
                    self.expected_closers.pop();
                    if self.expected_closers.is_empty() {
                        self.root_closed = true;
                    }
                }
                _ => {}
            }
        }

        if self.root_closed && !self.invalid && !self.parse_attempted {
            self.parse_attempted = true;
            self.strictly_complete = serde_json::from_str::<Value>(&self.raw_arguments)
                .is_ok_and(|value| value.is_object());
        }
        Ok(())
    }
}

fn is_json_whitespace(character: char) -> bool {
    matches!(character, ' ' | '\t' | '\n' | '\r')
}

impl AssistantStreamState {
    fn reset_for_run(&mut self) -> Result<(), String> {
        if let Some(sequence) = self.active_message_sequence {
            return Err(format!(
                "Pi started a new agent run while assistant message {sequence} was still active."
            ));
        }
        *self = Self::default();
        Ok(())
    }

    fn begin_message(&mut self) -> Result<u64, String> {
        if let Some(sequence) = self.active_message_sequence {
            return Err(format!(
                "Pi started an assistant message while assistant message {sequence} was still active."
            ));
        }
        self.next_message_sequence = self
            .next_message_sequence
            .checked_add(1)
            .ok_or_else(|| "Pi assistant message sequence overflowed.".to_string())?;
        let sequence = self.next_message_sequence;
        self.active_message_sequence = Some(sequence);
        self.streamed_tool_calls.clear();
        self.tool_input_scans.clear();
        Ok(sequence)
    }

    fn active_message_sequence(&self) -> Result<u64, String> {
        self.active_message_sequence.ok_or_else(|| {
            "Pi emitted an assistant stream event outside an assistant message.".to_string()
        })
    }

    fn ensure_idle(&self) -> Result<(), String> {
        if let Some(sequence) = self.active_message_sequence {
            return Err(format!(
                "Pi settled while assistant message {sequence} was still active."
            ));
        }
        Ok(())
    }

    fn stream_id(
        &self,
        generation: u64,
        block_kind: &str,
        content_index: u64,
    ) -> Result<String, String> {
        Ok(format!(
            "{block_kind}-{generation}-{}-{content_index}",
            self.active_message_sequence()?
        ))
    }

    fn register_tool_call(&mut self, content_index: u64, id: &str) -> Result<bool, String> {
        self.active_message_sequence()?;
        match self.streamed_tool_calls.get(&content_index) {
            Some(existing) if existing.id == id => Ok(false),
            Some(existing) => Err(format!(
                "Pi changed tool-call identity at assistant content index {content_index} from {} to {id}.",
                existing.id
            )),
            None => {
                self.streamed_tool_calls.insert(
                    content_index,
                    StreamedToolCallState {
                        id: id.to_string(),
                        input_complete: false,
                    },
                );
                Ok(true)
            }
        }
    }

    fn start_tool_input(&mut self, content_index: u64) -> Result<(), String> {
        self.active_message_sequence()?;
        self.tool_input_scans
            .insert(content_index, ToolInputScanState::default());
        Ok(())
    }

    fn append_tool_input(&mut self, content_index: u64, delta: &str) -> Result<bool, String> {
        self.active_message_sequence()?;
        let received_after_completion = self
            .streamed_tool_calls
            .get(&content_index)
            .is_some_and(|tool_call| tool_call.input_complete)
            && !delta.trim().is_empty();
        self.tool_input_scans
            .entry(content_index)
            .or_default()
            .append(delta)?;
        Ok(received_after_completion)
    }

    fn tool_input_payload(&self, content_index: u64, fallback: &Value) -> (Value, &'static str) {
        let raw_arguments = self
            .tool_input_scans
            .get(&content_index)
            .map(|scan| scan.raw_arguments.as_str())
            .filter(|raw_arguments| !raw_arguments.trim().is_empty());
        match raw_arguments {
            Some(raw_arguments) => (Value::String(raw_arguments.to_string()), "raw_delta"),
            None => (fallback.clone(), "partial_snapshot"),
        }
    }

    fn finish_tool_input(
        &mut self,
        content_index: u64,
        id: &str,
        authoritative_end: bool,
    ) -> Result<Option<ToolInputCompletionSource>, String> {
        let tool_call = self
            .streamed_tool_calls
            .get_mut(&content_index)
            .ok_or_else(|| {
                format!(
                    "Pi ended tool call {id} at assistant content index {content_index} before it started."
                )
            })?;
        if tool_call.id != id {
            return Err(format!(
                "Pi ended tool call {id} at assistant content index {content_index}, which belongs to {}.",
                tool_call.id
            ));
        }
        if tool_call.input_complete {
            return Ok(None);
        }
        let source = if self
            .tool_input_scans
            .get(&content_index)
            .is_some_and(|scan| scan.strictly_complete)
        {
            Some(ToolInputCompletionSource::Json)
        } else if authoritative_end {
            Some(ToolInputCompletionSource::ToolcallEnd)
        } else {
            None
        };
        if source.is_none() {
            return Ok(None);
        }
        tool_call.input_complete = true;
        Ok(source)
    }

    fn tool_input_diagnostics(&self, content_index: u64) -> (usize, u64) {
        self.tool_input_scans
            .get(&content_index)
            .map(|scan| (scan.raw_arguments.len(), scan.delta_count))
            .unwrap_or_default()
    }

    fn end_message(&mut self) -> Result<(u64, usize), String> {
        let sequence = self.active_message_sequence.take().ok_or_else(|| {
            "Pi ended an assistant message when no assistant message was active.".to_string()
        })?;
        let incomplete_tool_calls = self
            .streamed_tool_calls
            .values()
            .filter(|tool_call| !tool_call.input_complete)
            .map(|tool_call| tool_call.id.as_str())
            .collect::<Vec<_>>();
        if !incomplete_tool_calls.is_empty() {
            self.active_message_sequence = Some(sequence);
            return Err(format!(
                "Pi ended assistant message {sequence} before tool-call input completed: {}.",
                incomplete_tool_calls.join(", ")
            ));
        }
        let tool_call_count = self.streamed_tool_calls.len();
        self.streamed_tool_calls.clear();
        Ok((sequence, tool_call_count))
    }
}

#[derive(Debug, Eq, PartialEq)]
struct ToolCallSnapshot {
    id: String,
    name: String,
    arguments: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentConfiguration {
    pub provider: String,
    pub model_id: String,
    pub thinking_level: String,
    pub auto_compaction: bool,
    pub auto_retry: bool,
}

#[derive(Clone, Debug)]
pub struct PromptTrace {
    message_id: String,
    host_started_at: Instant,
    provider: String,
    model_id: String,
    client_reused: bool,
}

impl PromptTrace {
    pub fn new(
        message_id: &str,
        host_started_at: Instant,
        configuration: &AgentConfiguration,
        client_reused: bool,
    ) -> Self {
        Self {
            message_id: message_id.to_string(),
            host_started_at,
            provider: configuration.provider.clone(),
            model_id: configuration.model_id.clone(),
            client_reused,
        }
    }
}

#[derive(Debug, Default)]
struct PromptTraceState {
    pending: Option<PromptTrace>,
    active: Option<PromptTrace>,
}

impl PromptTraceState {
    fn register(&mut self, trace: PromptTrace) -> Option<PromptTrace> {
        self.pending.replace(trace)
    }

    fn cancel_pending(&mut self, message_id: &str) {
        if self
            .pending
            .as_ref()
            .is_some_and(|trace| trace.message_id == message_id)
        {
            self.pending = None;
        }
    }

    fn start_run(&mut self) -> Option<PromptTrace> {
        if let Some(trace) = self.pending.take() {
            self.active = Some(trace);
        }
        self.active.clone()
    }

    fn active(&self) -> Option<PromptTrace> {
        self.active.clone()
    }

    fn settle(&mut self) -> Option<PromptTrace> {
        self.active.take()
    }
}

pub struct RpcClient {
    app: AppHandle,
    logger: RuntimeLogger,
    pub context: ChatContext,
    pub tools_key: String,
    child: AsyncMutex<Child>,
    configuration: AsyncMutex<Option<AgentConfiguration>>,
    stdin: AsyncMutex<ChildStdin>,
    pending: Mutex<HashMap<String, PendingResponse>>,
    active_operations: AtomicUsize,
    next_request: AtomicU64,
    alive: AtomicBool,
    streaming: AtomicBool,
    run_generation: AtomicU64,
    run_started_at: Mutex<Option<Instant>>,
    settled_generation: AtomicU64,
    first_output_observed: AtomicBool,
    prompt_trace: Mutex<PromptTraceState>,
    assistant_stream: Mutex<AssistantStreamState>,
    session_store: Option<SessionStore>,
    emit_events: bool,
}

impl RpcClient {
    async fn spawn_process(
        app: AppHandle,
        binary: &Path,
        environment: &ShellEnvironment,
        logger: RuntimeLogger,
        context: ChatContext,
        tools_key: String,
        session_store: Option<SessionStore>,
        session_file: Option<&str>,
        no_session: bool,
        emit_events: bool,
    ) -> Result<(Arc<Self>, Instant), String> {
        let startup_started = Instant::now();
        if let Some(path) = session_file {
            let metadata = std::fs::metadata(path).map_err(|error| {
                format!("Mapped Pi session file is unavailable at {path}: {error}")
            })?;
            if !metadata.is_file() {
                return Err(format!("Mapped Pi session path is not a file: {path}"));
            }
        }

        let mut command = Command::new(binary);
        command
            .args(["--mode", "rpc"])
            .current_dir(&context.cwd)
            .envs(&environment.values)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if no_session {
            command.arg("--no-session");
        } else if let Some(path) = session_file {
            command.args(["--session", path]);
        } else {
            command.args(["--name", &context.session_id]);
        }
        command.args(["--tools", &tools_key]);

        logger.record(
            "info",
            "pi.process",
            "Starting user-installed Pi RPC process",
            Some(json!({
                "binaryPath": binary,
                "cwd": context.cwd,
                "sessionId": context.session_id,
                "resumingSession": session_file.is_some(),
                "ephemeral": no_session,
                "tools": tools_key,
            })),
        );
        let mut child = command.spawn().map_err(|error| {
            format!(
                "Failed to start Pi at {} for {}: {error}",
                binary.display(),
                context.session_id
            )
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Pi RPC stdin was not piped.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Pi RPC stdout was not piped.".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Pi RPC stderr was not piped.".to_string())?;
        let client = Arc::new(Self {
            app,
            logger,
            context,
            tools_key,
            child: AsyncMutex::new(child),
            configuration: AsyncMutex::new(None),
            stdin: AsyncMutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            active_operations: AtomicUsize::new(0),
            next_request: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            streaming: AtomicBool::new(false),
            run_generation: AtomicU64::new(0),
            run_started_at: Mutex::new(None),
            settled_generation: AtomicU64::new(0),
            first_output_observed: AtomicBool::new(false),
            prompt_trace: Mutex::new(PromptTraceState::default()),
            assistant_stream: Mutex::new(AssistantStreamState::default()),
            session_store,
            emit_events,
        });

        let stdout_client = Arc::clone(&client);
        tokio::spawn(async move { stdout_client.read_stdout(stdout).await });
        let stderr_client = Arc::clone(&client);
        tokio::spawn(async move { stderr_client.read_stderr(stderr).await });

        Ok((client, startup_started))
    }

    async fn wait_until_ready(&self, startup_started: Instant) -> Result<(), String> {
        // A command round trip proves that startup, framing, and the selected session work.
        self.call(json!({ "type": "get_state" })).await?;
        self.logger.record(
            "info",
            "pi.process.timing",
            "Pi RPC process became ready",
            Some(json!({
                "sessionId": self.context.session_id,
                "startupMilliseconds": startup_started.elapsed().as_millis(),
            })),
        );
        Ok(())
    }

    async fn spawn(
        app: AppHandle,
        binary: &Path,
        environment: &ShellEnvironment,
        logger: RuntimeLogger,
        context: ChatContext,
        tools_key: String,
        session_store: Option<SessionStore>,
        session_file: Option<&str>,
        no_session: bool,
        emit_events: bool,
    ) -> Result<Arc<Self>, String> {
        let (client, startup_started) = Self::spawn_process(
            app,
            binary,
            environment,
            logger,
            context,
            tools_key,
            session_store,
            session_file,
            no_session,
            emit_events,
        )
        .await?;

        if let Err(error) = client.wait_until_ready(startup_started).await {
            if client.is_alive() {
                client.stop().await?;
            }
            return Err(error);
        }
        Ok(client)
    }

    fn active_operation_count(&self) -> usize {
        self.active_operations.load(Ordering::SeqCst)
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    pub fn is_streaming(&self) -> bool {
        self.streaming.load(Ordering::SeqCst)
    }

    fn confirm_session_mapping_ready(&self) -> Result<(), String> {
        let Some(store) = &self.session_store else {
            return Ok(());
        };
        let Some(mapping) = store.get(&self.context.session_id)? else {
            return Ok(());
        };
        if mapping.ready {
            return Ok(());
        }
        let path = Path::new(&mapping.session_file);
        if !session_file_is_materialized(path)? {
            return Err(format!(
                "Pi run settled without materializing its reported session file for {}: {}",
                self.context.session_id,
                path.display()
            ));
        }
        store.mark_ready(&self.context.session_id, &mapping.session_file)?;
        Ok(())
    }

    fn settle_prompt_trace(&self) -> Result<Option<PromptTrace>, String> {
        Ok(self
            .prompt_trace
            .lock()
            .map_err(|_| "Pi prompt-trace mutex was poisoned.".to_string())?
            .settle())
    }

    pub async fn configure(&self, configuration: &AgentConfiguration) -> Result<(), String> {
        let mut current = self.configuration.lock().await;
        if current.as_ref() == Some(configuration) {
            self.logger.record(
                "info",
                "pi.configuration.timing",
                "Reused the active Pi configuration",
                Some(json!({ "sessionId": self.context.session_id })),
            );
            return Ok(());
        }
        let started = Instant::now();
        self.call(json!({
            "type": "set_model",
            "provider": configuration.provider,
            "modelId": configuration.model_id,
        }))
        .await?;
        self.call(json!({
            "type": "set_thinking_level",
            "level": configuration.thinking_level,
        }))
        .await?;
        self.call(json!({
            "type": "set_auto_compaction",
            "enabled": configuration.auto_compaction,
        }))
        .await?;
        self.call(json!({
            "type": "set_auto_retry",
            "enabled": configuration.auto_retry,
        }))
        .await?;
        *current = Some(configuration.clone());
        self.logger.record(
            "info",
            "pi.configuration.timing",
            "Applied Pi configuration",
            Some(json!({
                "durationMilliseconds": started.elapsed().as_millis(),
                "modelId": configuration.model_id,
                "provider": configuration.provider,
                "sessionId": self.context.session_id,
            })),
        );
        Ok(())
    }

    pub async fn call(&self, mut command: Value) -> Result<Value, String> {
        let started = Instant::now();
        if !self.is_alive() {
            return Err(format!(
                "Pi RPC process for {} is not running.",
                self.context.session_id
            ));
        }
        let object = command
            .as_object_mut()
            .ok_or_else(|| "Pi RPC command must be a JSON object.".to_string())?;
        let command_type = object
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| "Pi RPC command is missing type.".to_string())?
            .to_string();
        let id = format!(
            "pi-gui-{}-{}",
            self.context.session_id,
            self.next_request.fetch_add(1, Ordering::SeqCst)
        );
        object.insert("id".to_string(), Value::String(id.clone()));
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| "Pi RPC pending-request mutex was poisoned.".to_string())?
            .insert(id.clone(), sender);

        if let Err(error) = self.write_json_line(&command).await {
            self.pending
                .lock()
                .map_err(|_| "Pi RPC pending-request mutex was poisoned.".to_string())?
                .remove(&id);
            return Err(error);
        }
        let response = match timeout(RPC_TIMEOUT, receiver).await {
            Ok(Ok(response)) => response?,
            Ok(Err(_)) => {
                return Err(format!(
                    "Pi RPC response channel closed for {command_type}."
                ));
            }
            Err(_) => {
                self.pending
                    .lock()
                    .map_err(|_| "Pi RPC pending-request mutex was poisoned.".to_string())?
                    .remove(&id);
                return Err(format!(
                    "Pi RPC command {command_type} timed out after {} seconds.",
                    RPC_TIMEOUT.as_secs()
                ));
            }
        };
        if response.get("command").and_then(Value::as_str) != Some(command_type.as_str()) {
            return Err(format!(
                "Pi RPC response command mismatch: expected {command_type}, received {}.",
                response
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or("<missing>")
            ));
        }
        if response.get("success").and_then(Value::as_bool) != Some(true) {
            return Err(response
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    format!("Pi RPC command {command_type} failed without an error message.")
                }));
        }
        if matches!(
            command_type.as_str(),
            "prompt"
                | "set_model"
                | "set_thinking_level"
                | "set_auto_compaction"
                | "set_auto_retry"
                | "get_available_models"
        ) {
            self.logger.record(
                "info",
                "pi.rpc.timing",
                "Pi RPC command completed",
                Some(json!({
                    "command": command_type,
                    "durationMilliseconds": started.elapsed().as_millis(),
                    "sessionId": self.context.session_id,
                })),
            );
        }
        Ok(response.get("data").cloned().unwrap_or(Value::Null))
    }

    pub async fn call_prompt(&self, command: Value, trace: PromptTrace) -> Result<Value, String> {
        let message_id = trace.message_id.clone();
        let replaced = self
            .prompt_trace
            .lock()
            .map_err(|_| "Pi prompt-trace mutex was poisoned.".to_string())?
            .register(trace);
        if let Some(replaced) = replaced {
            self.logger.record(
                "warn",
                "pi.send.trace",
                "Replaced a Pi prompt trace that did not reach agent_start",
                Some(json!({
                    "newMessageId": message_id,
                    "replacedMessageId": replaced.message_id,
                    "sessionId": self.context.session_id,
                })),
            );
        }

        let result = self.call(command).await;
        if result.is_err() {
            self.prompt_trace
                .lock()
                .map_err(|_| "Pi prompt-trace mutex was poisoned.".to_string())?
                .cancel_pending(&message_id);
        }
        result
    }

    async fn write_json_line(&self, value: &Value) -> Result<(), String> {
        let encoded = serde_json::to_vec(value)
            .map_err(|error| format!("Failed to encode Pi RPC command: {error}"))?;
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(&encoded).await.map_err(|error| {
            format!(
                "Failed to write to Pi RPC process for {}: {error}",
                self.context.session_id
            )
        })?;
        stdin.write_all(b"\n").await.map_err(|error| {
            format!(
                "Failed to terminate Pi RPC command for {}: {error}",
                self.context.session_id
            )
        })?;
        stdin.flush().await.map_err(|error| {
            format!(
                "Failed to flush Pi RPC command for {}: {error}",
                self.context.session_id
            )
        })
    }

    async fn read_stdout(self: Arc<Self>, stdout: tokio::process::ChildStdout) {
        let mut reader = BufReader::new(stdout);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer).await {
                Ok(0) => {
                    self.fail_process("Pi RPC stdout closed unexpectedly.")
                        .await;
                    return;
                }
                Ok(_) => {}
                Err(error) => {
                    self.fail_process(&format!("Failed to read Pi RPC stdout: {error}"))
                        .await;
                    return;
                }
            }
            if !buffer.ends_with(b"\n") {
                self.fail_process("Pi RPC emitted an unterminated JSONL record.")
                    .await;
                return;
            }
            if buffer.len() > MAX_RPC_LINE_BYTES {
                self.fail_process(&format!(
                    "Pi RPC record exceeded the {} byte safety limit.",
                    MAX_RPC_LINE_BYTES
                ))
                .await;
                return;
            }
            buffer.pop();
            if buffer.last() == Some(&b'\r') {
                self.fail_process("Pi RPC emitted CRLF; strict JSONL requires LF framing.")
                    .await;
                return;
            }
            let line = match std::str::from_utf8(&buffer) {
                Ok(line) => line,
                Err(error) => {
                    self.fail_process(&format!("Pi RPC emitted non-UTF-8 stdout: {error}"))
                        .await;
                    return;
                }
            };
            let value: Value = match serde_json::from_str(line) {
                Ok(value) => value,
                Err(error) => {
                    self.fail_process(&format!("Pi RPC emitted invalid JSON: {error}"))
                        .await;
                    return;
                }
            };
            if let Err(error) = self.handle_output(value).await {
                self.fail_process(&error).await;
                return;
            }
        }
    }

    async fn read_stderr(self: Arc<Self>, stderr: tokio::process::ChildStderr) {
        let mut lines = BufReader::new(stderr).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => self.logger.record(
                    "warn",
                    "pi.stderr",
                    "Pi wrote to stderr",
                    Some(json!({
                        "sessionId": self.context.session_id,
                        "line": line,
                    })),
                ),
                Ok(None) => return,
                Err(error) => {
                    self.logger.record(
                        "error",
                        "pi.stderr",
                        "Failed reading Pi stderr",
                        Some(json!({
                            "sessionId": self.context.session_id,
                            "error": error.to_string(),
                        })),
                    );
                    return;
                }
            }
        }
    }

    async fn handle_output(self: &Arc<Self>, value: Value) -> Result<(), String> {
        let record_type = value
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| "Pi RPC record is missing type.".to_string())?;
        if record_type == "response" {
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "Pi RPC response is missing id.".to_string())?
                .to_string();
            let sender = self
                .pending
                .lock()
                .map_err(|_| "Pi RPC pending-request mutex was poisoned.".to_string())?
                .remove(&id)
                .ok_or_else(|| format!("Pi RPC returned an unknown response id: {id}"))?;
            if sender.send(Ok(value)).is_err() {
                self.logger.record(
                    "warn",
                    "pi.rpc",
                    "RPC caller dropped before its response arrived",
                    Some(json!({
                        "sessionId": self.context.session_id,
                        "requestId": id,
                    })),
                );
            }
            return Ok(());
        }
        if record_type == "extension_ui_request" {
            return self.handle_extension_ui(&value).await;
        }
        self.handle_event(&value)
    }

    async fn handle_extension_ui(&self, value: &Value) -> Result<(), String> {
        let method = value
            .get("method")
            .and_then(Value::as_str)
            .ok_or_else(|| "Pi extension UI request is missing method.".to_string())?;
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Pi extension UI request is missing id.".to_string())?;
        if matches!(method, "select" | "confirm" | "input" | "editor") {
            self.logger.record(
                "warn",
                "pi.extension_ui",
                "Cancelled unsupported extension dialog request",
                Some(json!({
                    "sessionId": self.context.session_id,
                    "requestId": id,
                    "method": method,
                })),
            );
            self.write_json_line(&json!({
                "type": "extension_ui_response",
                "id": id,
                "cancelled": true,
            }))
            .await?;
            self.emit(json!({
                "type": "status_message",
                "id": format!("extension-ui-{id}"),
                "role": "system",
                "status": "finished",
                "text": "Pi extension requested an interactive dialog that this prototype does not expose; the request was cancelled.",
                "timestamp": timestamp(),
            }))?;
            return Ok(());
        }
        if method == "notify" {
            let message = value.get("message").and_then(Value::as_str).unwrap_or("");
            let role = if value.get("notifyType").and_then(Value::as_str) == Some("error") {
                "error"
            } else {
                "system"
            };
            self.emit(json!({
                "type": "status_message",
                "id": format!("extension-ui-{id}"),
                "role": role,
                "status": "finished",
                "text": message,
                "timestamp": timestamp(),
            }))?;
        } else {
            self.logger.record(
                "info",
                "pi.extension_ui",
                "Observed fire-and-forget extension UI request",
                Some(json!({
                    "sessionId": self.context.session_id,
                    "requestId": id,
                    "method": method,
                })),
            );
        }
        Ok(())
    }

    fn handle_event(self: &Arc<Self>, value: &Value) -> Result<(), String> {
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| "Pi event is missing type.".to_string())?;
        match event_type {
            "agent_start" => {
                self.streaming.store(true, Ordering::SeqCst);
                self.run_generation.fetch_add(1, Ordering::SeqCst);
                let generation = self.run_generation.load(Ordering::SeqCst);
                self.first_output_observed.store(false, Ordering::SeqCst);
                *self
                    .run_started_at
                    .lock()
                    .map_err(|_| "Pi run timing mutex was poisoned.".to_string())? =
                    Some(Instant::now());
                self.assistant_stream
                    .lock()
                    .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
                    .reset_for_run()?;
                let prompt_trace = self
                    .prompt_trace
                    .lock()
                    .map_err(|_| "Pi prompt-trace mutex was poisoned.".to_string())?
                    .start_run();
                if let Some(trace) = prompt_trace {
                    self.logger.record(
                        "info",
                        "pi.send.timing",
                        "Pi agent run started for the submitted message",
                        Some(json!({
                            "clientReused": trace.client_reused,
                            "generation": generation,
                            "hostToAgentStartMilliseconds": trace.host_started_at.elapsed().as_millis(),
                            "messageId": trace.message_id,
                            "modelId": trace.model_id,
                            "provider": trace.provider,
                            "sessionId": self.context.session_id,
                        })),
                    );
                }
                self.emit(json!({
                    "generation": generation,
                    "type": "run_status",
                    "status": "running",
                    "timestamp": timestamp(),
                }))
            }
            "agent_end" => {
                let will_retry = required_bool(value, "willRetry")?;
                if will_retry {
                    self.logger.record(
                        "info",
                        "pi.event.lifecycle",
                        "Pi low-level agent run ended and will retry",
                        Some(json!({ "sessionId": self.context.session_id })),
                    );
                    return Ok(());
                }
                self.schedule_legacy_agent_settle();
                Ok(())
            }
            "agent_settled" => {
                self.assistant_stream
                    .lock()
                    .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
                    .ensure_idle()?;
                let generation = self.run_generation.load(Ordering::SeqCst);
                let previous = self
                    .settled_generation
                    .fetch_max(generation, Ordering::SeqCst);
                self.streaming.store(false, Ordering::SeqCst);
                let duration_milliseconds = self
                    .run_started_at
                    .lock()
                    .map_err(|_| "Pi run timing mutex was poisoned.".to_string())?
                    .take()
                    .map(|started| started.elapsed().as_millis());
                let prompt_trace = self.settle_prompt_trace()?;
                self.logger.record(
                    "info",
                    "pi.event.lifecycle",
                    "Pi agent run fully settled",
                    Some(json!({
                        "generation": generation,
                        "hostToSettledMilliseconds": prompt_trace
                            .as_ref()
                            .map(|trace| trace.host_started_at.elapsed().as_millis()),
                        "messageId": prompt_trace.as_ref().map(|trace| trace.message_id.as_str()),
                        "runMilliseconds": duration_milliseconds,
                        "sessionId": self.context.session_id,
                    })),
                );
                if previous >= generation {
                    return Ok(());
                }
                self.confirm_session_mapping_ready()?;
                self.emit(json!({
                    "generation": generation,
                    "type": "run_status",
                    "status": "finished",
                    "timestamp": timestamp(),
                }))
            }
            "message_start" => self.handle_message_start(value),
            "message_update" => self.handle_message_update(value),
            "message_end" => self.handle_message_end(value),
            "tool_execution_start" => self.emit(json!({
                "type": "tool_start",
                "id": required_string(value, "toolCallId")?,
                "name": required_string(value, "toolName")?,
                "args": value.get("args").cloned().unwrap_or(Value::Null),
                "timestamp": timestamp(),
            })),
            "tool_execution_update" => self.emit(json!({
                "type": "tool_update",
                "id": required_string(value, "toolCallId")?,
                "name": required_string(value, "toolName")?,
                "value": value.get("partialResult").cloned().unwrap_or(Value::Null),
                "phase": "output",
                "timestamp": timestamp(),
            })),
            "tool_execution_end" => self.emit(json!({
                "type": "tool_end",
                "id": required_string(value, "toolCallId")?,
                "name": required_string(value, "toolName")?,
                "result": value.get("result").cloned().unwrap_or(Value::Null),
                "isError": value.get("isError").and_then(Value::as_bool).unwrap_or(false),
                "timestamp": timestamp(),
            })),
            "queue_update" => self.emit(json!({
                "type": "queue_update",
                "steering": value.get("steering").cloned().unwrap_or_else(|| json!([])),
                "followUp": value.get("followUp").cloned().unwrap_or_else(|| json!([])),
                "timestamp": timestamp(),
            })),
            "compaction_start" => self.emit(json!({
                "type": "status_message",
                "id": "pi-compaction",
                "role": "system",
                "status": "streaming",
                "text": "Compacting context…",
                "timestamp": timestamp(),
            })),
            "compaction_end" => {
                let failed = value.get("errorMessage").and_then(Value::as_str);
                self.emit(json!({
                    "type": "status_message",
                    "id": "pi-compaction",
                    "role": if failed.is_some() { "error" } else { "system" },
                    "status": "finished",
                    "text": failed.unwrap_or("Context compacted."),
                    "timestamp": timestamp(),
                }))
            }
            "auto_retry_start" => self.emit(json!({
                "type": "status_message",
                "id": "pi-auto-retry",
                "role": "system",
                "status": "streaming",
                "text": format!(
                    "Retrying request ({}/{})…",
                    value.get("attempt").and_then(Value::as_u64).unwrap_or(0),
                    value.get("maxAttempts").and_then(Value::as_u64).unwrap_or(0)
                ),
                "timestamp": timestamp(),
            })),
            "auto_retry_end" => {
                let success = value.get("success").and_then(Value::as_bool) == Some(true);
                self.emit(json!({
                    "type": "status_message",
                    "id": "pi-auto-retry",
                    "role": if success { "system" } else { "error" },
                    "status": "finished",
                    "text": if success {
                        "Retry succeeded."
                    } else {
                        value.get("finalError").and_then(Value::as_str).unwrap_or("Retry failed.")
                    },
                    "timestamp": timestamp(),
                }))
            }
            "extension_error" => self.emit(json!({
                "type": "error",
                "id": format!("extension-error-{}", uuid::Uuid::new_v4()),
                "text": value.get("error").and_then(Value::as_str).unwrap_or("Pi extension failed."),
                "timestamp": timestamp(),
            })),
            // Turn boundaries carry information already represented by message and tool events.
            "turn_start" | "turn_end" => Ok(()),
            // Pi emits these state notifications after the corresponding configuration
            // commands. They do not represent chat content, but keeping them explicit
            // makes protocol drift observable without crashing a valid session.
            "model_changed"
            | "thinking_level_changed"
            | "auto_compaction_changed"
            | "auto_retry_changed" => {
                self.logger.record(
                    "info",
                    "pi.event.state",
                    "Observed Pi RPC state change",
                    Some(json!({
                        "event": value,
                        "sessionId": self.context.session_id,
                    })),
                );
                Ok(())
            }
            other => Err(format!("Unsupported Pi RPC event type: {other}")),
        }
    }

    fn schedule_legacy_agent_settle(self: &Arc<Self>) {
        let generation = self.run_generation.load(Ordering::SeqCst);
        let client = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(LEGACY_AGENT_SETTLE_GRACE).await;
            if !client.is_alive()
                || !client.is_streaming()
                || client.run_generation.load(Ordering::SeqCst) != generation
            {
                return;
            }
            let stream_state_result = client
                .assistant_stream
                .lock()
                .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())
                .and_then(|state| state.ensure_idle());
            if let Err(error) = stream_state_result {
                client.fail_process(&error).await;
                return;
            }
            let previous = client
                .settled_generation
                .fetch_max(generation, Ordering::SeqCst);
            if previous >= generation {
                return;
            }
            client.streaming.store(false, Ordering::SeqCst);
            let duration_result = client
                .run_started_at
                .lock()
                .map_err(|_| "Pi run timing mutex was poisoned.".to_string())
                .map(|mut started| started.take().map(|started| started.elapsed().as_millis()));
            let duration_milliseconds = match duration_result {
                Ok(duration) => duration,
                Err(error) => {
                    client.fail_process(&error).await;
                    return;
                }
            };
            let prompt_trace = match client.settle_prompt_trace() {
                Ok(trace) => trace,
                Err(error) => {
                    client.fail_process(&error).await;
                    return;
                }
            };
            client.logger.record(
                "warn",
                "pi.event.lifecycle",
                "Pi did not emit agent_settled; applied the legacy agent_end compatibility path",
                Some(json!({
                    "generation": generation,
                    "graceMilliseconds": LEGACY_AGENT_SETTLE_GRACE.as_millis(),
                    "hostToSettledMilliseconds": prompt_trace
                        .as_ref()
                        .map(|trace| trace.host_started_at.elapsed().as_millis()),
                    "messageId": prompt_trace.as_ref().map(|trace| trace.message_id.as_str()),
                    "runMilliseconds": duration_milliseconds,
                    "sessionId": client.context.session_id,
                })),
            );
            if let Err(error) = client.confirm_session_mapping_ready() {
                client.fail_process(&error).await;
                return;
            }
            if let Err(error) = client.emit(json!({
                "generation": generation,
                "type": "run_status",
                "status": "finished",
                "timestamp": timestamp(),
            })) {
                client.logger.record(
                    "error",
                    "pi.event",
                    "Failed to emit legacy Pi completion status",
                    Some(json!({
                        "error": error,
                        "sessionId": client.context.session_id,
                    })),
                );
            }
        });
    }

    fn handle_message_start(&self, value: &Value) -> Result<(), String> {
        match event_message_role(value)? {
            "assistant" => {
                let sequence = self
                    .assistant_stream
                    .lock()
                    .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
                    .begin_message()?;
                self.logger.record(
                    "info",
                    "pi.event.message",
                    "Pi assistant message started",
                    Some(json!({
                        "generation": self.run_generation.load(Ordering::SeqCst),
                        "messageSequence": sequence,
                        "sessionId": self.context.session_id,
                    })),
                );
                Ok(())
            }
            "user" | "toolResult" | "custom" => Ok(()),
            role => Err(format!(
                "Unsupported Pi message role at message_start: {role}"
            )),
        }
    }

    fn handle_message_end(&self, value: &Value) -> Result<(), String> {
        match event_message_role(value)? {
            "assistant" => {
                let (sequence, tool_call_count) = self
                    .assistant_stream
                    .lock()
                    .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
                    .end_message()?;
                self.logger.record(
                    "info",
                    "pi.event.message",
                    "Pi assistant message ended",
                    Some(json!({
                        "generation": self.run_generation.load(Ordering::SeqCst),
                        "messageSequence": sequence,
                        "sessionId": self.context.session_id,
                        "streamedToolCallCount": tool_call_count,
                    })),
                );
                Ok(())
            }
            "user" | "toolResult" | "custom" => Ok(()),
            role => Err(format!(
                "Unsupported Pi message role at message_end: {role}"
            )),
        }
    }

    fn handle_message_update(&self, value: &Value) -> Result<(), String> {
        if event_message_role(value)? != "assistant" {
            return Err("Pi message_update did not contain an assistant message.".to_string());
        }
        let event = value
            .get("assistantMessageEvent")
            .and_then(Value::as_object)
            .ok_or_else(|| "Pi message_update is missing assistantMessageEvent.".to_string())?;
        let kind = event
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| "Pi assistant message event is missing type.".to_string())?;
        let first_output_timing = if matches!(
            kind,
            "text_delta" | "thinking_delta" | "toolcall_start" | "toolcall_delta"
        ) && !self.first_output_observed.swap(true, Ordering::SeqCst)
        {
            let first_output_milliseconds = self
                .run_started_at
                .lock()
                .map_err(|_| "Pi run timing mutex was poisoned.".to_string())?
                .as_ref()
                .map(Instant::elapsed)
                .map(|duration| duration.as_millis());
            let prompt_trace = self
                .prompt_trace
                .lock()
                .map_err(|_| "Pi prompt-trace mutex was poisoned.".to_string())?
                .active();
            Some(json!({
                "clientReused": prompt_trace.as_ref().map(|trace| trace.client_reused),
                "firstOutputMilliseconds": first_output_milliseconds,
                "hostToFirstOutputMilliseconds": prompt_trace
                    .as_ref()
                    .map(|trace| trace.host_started_at.elapsed().as_millis()),
                "messageId": prompt_trace.as_ref().map(|trace| trace.message_id.as_str()),
                "modelId": prompt_trace.as_ref().map(|trace| trace.model_id.as_str()),
                "outputKind": kind,
                "provider": prompt_trace.as_ref().map(|trace| trace.provider.as_str()),
                "sessionId": self.context.session_id,
            }))
        } else {
            None
        };
        let index = event.get("contentIndex").and_then(Value::as_u64);
        let emit_result = match kind {
            "text_start" => self.emit_stream_event(
                "text",
                required_content_index(index, kind)?,
                "assistant_text_start",
                None,
                None,
            ),
            "text_delta" => self.emit_stream_event(
                "text",
                required_content_index(index, kind)?,
                "assistant_text_delta",
                event.get("delta").and_then(Value::as_str),
                None,
            ),
            "text_end" => self.emit_stream_event(
                "text",
                required_content_index(index, kind)?,
                "assistant_text_end",
                None,
                event.get("content").and_then(Value::as_str),
            ),
            "thinking_start" => self.emit_stream_event(
                "thinking",
                required_content_index(index, kind)?,
                "thinking_start",
                None,
                None,
            ),
            "thinking_delta" => self.emit_stream_event(
                "thinking",
                required_content_index(index, kind)?,
                "thinking_delta",
                event.get("delta").and_then(Value::as_str),
                None,
            ),
            "thinking_end" => self.emit_stream_event(
                "thinking",
                required_content_index(index, kind)?,
                "thinking_end",
                None,
                event.get("content").and_then(Value::as_str),
            ),
            "toolcall_start" | "toolcall_delta" => self.handle_tool_call_input_update(
                event,
                required_content_index(index, kind)?,
                kind,
            ),
            "toolcall_end" => {
                self.handle_tool_call_input_end(event, required_content_index(index, kind)?)
            }
            "error" => {
                self.streaming.store(false, Ordering::SeqCst);
                self.emit(json!({
                    "type": "error",
                    "id": format!("assistant-error-{}", uuid::Uuid::new_v4()),
                    "text": event.get("error").and_then(Value::as_str).unwrap_or("Pi model stream failed."),
                    "timestamp": timestamp(),
                }))?;
                self.emit(json!({
                    "type": "run_status",
                    "status": "error",
                    "text": event.get("error").and_then(Value::as_str).unwrap_or("Pi model stream failed."),
                    "timestamp": timestamp(),
                }))
            }
            "start" | "done" => Ok(()),
            other => Err(format!("Unsupported Pi assistant stream event: {other}")),
        };
        if let Some(data) = first_output_timing {
            self.logger.record(
                "info",
                "pi.response.timing",
                "Received the first Pi model output",
                Some(data),
            );
        }
        emit_result
    }

    fn handle_tool_call_input_update(
        &self,
        event: &Map<String, Value>,
        content_index: u64,
        event_kind: &str,
    ) -> Result<(), String> {
        if event_kind == "toolcall_start" {
            self.assistant_stream
                .lock()
                .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
                .start_tool_input(content_index)?;
        } else if event_kind == "toolcall_delta" {
            let delta = event
                .get("delta")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    format!(
                        "Pi toolcall_delta event at content index {content_index} is missing string delta."
                    )
                })?;
            let received_after_completion = self
                .assistant_stream
                .lock()
                .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
                .append_tool_input(content_index, delta)?;
            if received_after_completion {
                self.logger.record(
                    "error",
                    "pi.event.tool_input",
                    "Pi tool input received data after JSON completion",
                    Some(json!({
                        "contentIndex": content_index,
                        "generation": self.run_generation.load(Ordering::SeqCst),
                        "sessionId": self.context.session_id,
                    })),
                );
            }
        }
        let Some(tool_call) = tool_call_from_partial(event, content_index)? else {
            if event_kind == "toolcall_start" {
                let message_sequence = self
                    .assistant_stream
                    .lock()
                    .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
                    .active_message_sequence()?;
                self.logger.record(
                    "info",
                    "pi.event.tool_input",
                    "Deferred streamed Pi tool call until its stable identity is available",
                    Some(json!({
                        "contentIndex": content_index,
                        "generation": self.run_generation.load(Ordering::SeqCst),
                        "messageSequence": message_sequence,
                        "sessionId": self.context.session_id,
                    })),
                );
            }
            return Ok(());
        };
        let should_start = self.register_streamed_tool_call(content_index, &tool_call.id)?;
        let (input, input_source) = self
            .assistant_stream
            .lock()
            .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
            .tool_input_payload(content_index, &tool_call.arguments);
        if should_start {
            self.emit_tool_input_start(&tool_call, content_index, input.clone(), input_source)?;
        }
        if event_kind == "toolcall_delta" {
            self.emit(json!({
                "type": "tool_update",
                "id": tool_call.id,
                "name": tool_call.name,
                "value": input,
                "phase": "input",
                "timestamp": timestamp(),
            }))?;
            let completion_source = self
                .assistant_stream
                .lock()
                .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
                .finish_tool_input(content_index, &tool_call.id, false)?;
            if let Some(completion_source) = completion_source {
                self.emit_tool_input_end(&tool_call, content_index, completion_source)?;
            }
        }
        Ok(())
    }

    fn handle_tool_call_input_end(
        &self,
        event: &Map<String, Value>,
        content_index: u64,
    ) -> Result<(), String> {
        let tool_call = final_tool_call(event, content_index)?;
        let should_start = self.register_streamed_tool_call(content_index, &tool_call.id)?;
        let (input, input_source) = self
            .assistant_stream
            .lock()
            .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
            .tool_input_payload(content_index, &tool_call.arguments);
        if should_start {
            self.emit_tool_input_start(&tool_call, content_index, input.clone(), input_source)?;
        } else {
            self.emit(json!({
                "type": "tool_update",
                "id": tool_call.id,
                "name": tool_call.name,
                "value": input,
                "phase": "input",
                "timestamp": timestamp(),
            }))?;
        }
        let completion_source = self
            .assistant_stream
            .lock()
            .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
            .finish_tool_input(content_index, &tool_call.id, true)?;
        if let Some(completion_source) = completion_source {
            self.emit_tool_input_end(&tool_call, content_index, completion_source)?;
        }
        Ok(())
    }

    fn register_streamed_tool_call(
        &self,
        content_index: u64,
        tool_call_id: &str,
    ) -> Result<bool, String> {
        self.assistant_stream
            .lock()
            .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
            .register_tool_call(content_index, tool_call_id)
    }

    fn emit_tool_input_start(
        &self,
        tool_call: &ToolCallSnapshot,
        content_index: u64,
        input: Value,
        input_source: &'static str,
    ) -> Result<(), String> {
        self.emit(json!({
            "type": "tool_start",
            "id": tool_call.id,
            "name": tool_call.name,
            "args": input,
            "timestamp": timestamp(),
        }))?;
        let message_sequence = self
            .assistant_stream
            .lock()
            .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
            .active_message_sequence()?;
        self.logger.record(
            "info",
            "pi.event.tool_input",
            "Started streaming Pi tool-call input",
            Some(json!({
                "contentIndex": content_index,
                "generation": self.run_generation.load(Ordering::SeqCst),
                "inputSource": input_source,
                "messageSequence": message_sequence,
                "sessionId": self.context.session_id,
                "toolCallId": tool_call.id,
                "toolName": tool_call.name,
            })),
        );
        Ok(())
    }

    fn emit_tool_input_end(
        &self,
        tool_call: &ToolCallSnapshot,
        content_index: u64,
        completion_source: ToolInputCompletionSource,
    ) -> Result<(), String> {
        self.emit(json!({
            "type": "tool_input_end",
            "id": tool_call.id,
            "timestamp": timestamp(),
        }))?;
        let (input_bytes, input_delta_count, message_sequence) = {
            let state = self
                .assistant_stream
                .lock()
                .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?;
            let (input_bytes, input_delta_count) = state.tool_input_diagnostics(content_index);
            (
                input_bytes,
                input_delta_count,
                state.active_message_sequence()?,
            )
        };
        self.logger.record(
            "info",
            "pi.event.tool_input",
            "Pi tool-call input stream completed",
            Some(json!({
                "completionSource": completion_source.as_str(),
                "contentIndex": content_index,
                "generation": self.run_generation.load(Ordering::SeqCst),
                "inputBytes": input_bytes,
                "inputDeltaCount": input_delta_count,
                "messageSequence": message_sequence,
                "sessionId": self.context.session_id,
                "toolCallId": tool_call.id,
                "toolName": tool_call.name,
            })),
        );
        Ok(())
    }

    fn emit_stream_event(
        &self,
        block_kind: &str,
        content_index: u64,
        event_type: &str,
        delta: Option<&str>,
        text: Option<&str>,
    ) -> Result<(), String> {
        let id = self
            .assistant_stream
            .lock()
            .map_err(|_| "Pi assistant-stream mutex was poisoned.".to_string())?
            .stream_id(
                self.run_generation.load(Ordering::SeqCst),
                block_kind,
                content_index,
            )?;
        let mut event = Map::new();
        event.insert("type".to_string(), Value::String(event_type.to_string()));
        event.insert("id".to_string(), Value::String(id));
        event.insert("timestamp".to_string(), Value::String(timestamp()));
        if let Some(delta) = delta {
            event.insert("delta".to_string(), Value::String(delta.to_string()));
        }
        if let Some(text) = text {
            event.insert("text".to_string(), Value::String(text.to_string()));
        }
        self.emit(Value::Object(event))
    }

    fn emit(&self, mut event: Value) -> Result<(), String> {
        if !self.emit_events {
            return Ok(());
        }
        event["context"] = json!({
            "sessionId": self.context.session_id,
            "projectPath": self.context.project_path,
        });
        self.app
            .emit("ousia:chat:event", event)
            .map_err(|error| format!("Failed to emit chat event: {error}"))
    }

    async fn fail_process(&self, reason: &str) {
        if !self.alive.swap(false, Ordering::SeqCst) {
            return;
        }
        self.streaming.store(false, Ordering::SeqCst);
        self.logger.record(
            "error",
            "pi.process",
            reason,
            Some(json!({ "sessionId": self.context.session_id })),
        );
        match self.pending.lock() {
            Ok(mut pending) => {
                for (request_id, sender) in pending.drain() {
                    if sender.send(Err(reason.to_string())).is_err() {
                        self.logger.record(
                            "warn",
                            "pi.rpc",
                            "Failed to deliver process failure to a dropped RPC caller",
                            Some(json!({
                                "sessionId": self.context.session_id,
                                "requestId": request_id,
                            })),
                        );
                    }
                }
            }
            Err(_) => self.logger.record(
                "error",
                "pi.rpc",
                "Pi RPC pending-request mutex was poisoned during process failure",
                Some(json!({ "sessionId": self.context.session_id })),
            ),
        }
        if let Err(error) = self.emit(json!({
            "type": "error",
            "id": format!("pi-process-error-{}", uuid::Uuid::new_v4()),
            "text": reason,
            "timestamp": timestamp(),
        })) {
            self.logger.record(
                "error",
                "pi.event",
                "Failed to emit Pi process error to the renderer",
                Some(json!({
                    "sessionId": self.context.session_id,
                    "error": error,
                })),
            );
        }
        if let Err(error) = self.emit(json!({
            "type": "run_status",
            "status": "error",
            "text": reason,
            "timestamp": timestamp(),
        })) {
            self.logger.record(
                "error",
                "pi.event",
                "Failed to emit Pi failure run status to the renderer",
                Some(json!({
                    "sessionId": self.context.session_id,
                    "error": error,
                })),
            );
        }
        let mut child = self.child.lock().await;
        if let Err(error) = child.start_kill() {
            self.logger.record(
                "error",
                "pi.process",
                "Failed to terminate broken Pi RPC process",
                Some(json!({
                    "sessionId": self.context.session_id,
                    "error": error.to_string(),
                })),
            );
        }
    }

    pub async fn stop(&self) -> Result<(), String> {
        self.alive.store(false, Ordering::SeqCst);
        match self.pending.lock() {
            Ok(mut pending) => {
                for (request_id, sender) in pending.drain() {
                    if sender
                        .send(Err("Pi RPC process was stopped.".to_string()))
                        .is_err()
                    {
                        self.logger.record(
                            "warn",
                            "pi.rpc",
                            "Failed to notify a dropped RPC caller during shutdown",
                            Some(json!({
                                "sessionId": self.context.session_id,
                                "requestId": request_id,
                            })),
                        );
                    }
                }
            }
            Err(_) => return Err("Pi RPC pending-request mutex was poisoned.".to_string()),
        }
        let mut child = self.child.lock().await;
        child
            .start_kill()
            .map_err(|error| format!("Failed to stop Pi RPC process: {error}"))?;
        match timeout(Duration::from_secs(3), child.wait()).await {
            Ok(Ok(status)) => {
                self.logger.record(
                    "info",
                    "pi.process",
                    "Stopped Pi RPC process",
                    Some(json!({
                        "sessionId": self.context.session_id,
                        "status": status.to_string(),
                    })),
                );
                Ok(())
            }
            Ok(Err(error)) => Err(format!("Failed waiting for Pi RPC process: {error}")),
            Err(_) => Err("Pi RPC process did not exit within 3 seconds.".to_string()),
        }
    }
}

pub struct RpcClientLease {
    client: Arc<RpcClient>,
    reused_existing_client: bool,
}

impl RpcClientLease {
    fn new(client: Arc<RpcClient>, reused_existing_client: bool) -> Self {
        client.active_operations.fetch_add(1, Ordering::SeqCst);
        Self {
            client,
            reused_existing_client,
        }
    }

    pub fn reused_existing_client(&self) -> bool {
        self.reused_existing_client
    }
}

impl std::ops::Deref for RpcClientLease {
    type Target = RpcClient;

    fn deref(&self) -> &Self::Target {
        &self.client
    }
}

impl Drop for RpcClientLease {
    fn drop(&mut self) {
        let previous = self.client.active_operations.fetch_sub(1, Ordering::SeqCst);
        debug_assert!(previous > 0, "Pi RPC active-operation counter underflowed");
    }
}

#[derive(Default)]
struct PrepareState {
    generation: u64,
    selected_session_id: Option<String>,
    clients: HashMap<String, Arc<RpcClient>>,
}

pub struct PrepareTicket {
    generation: u64,
    session_id: String,
    superseded_clients: Vec<Arc<RpcClient>>,
}

#[derive(Clone)]
pub struct PiHost {
    app: AppHandle,
    environment: ShellEnvironment,
    logger: RuntimeLogger,
    runtime: PiRuntimeManager,
    store: SessionStore,
    clients: Arc<AsyncMutex<HashMap<String, Arc<RpcClient>>>>,
    session_lifecycle_gates: Arc<AsyncMutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
    prepare_state: Arc<AsyncMutex<PrepareState>>,
}

impl PiHost {
    pub fn new(
        app: AppHandle,
        environment: ShellEnvironment,
        logger: RuntimeLogger,
        runtime: PiRuntimeManager,
        store: SessionStore,
    ) -> Self {
        Self {
            app,
            environment,
            logger,
            runtime,
            store,
            clients: Arc::new(AsyncMutex::new(HashMap::new())),
            session_lifecycle_gates: Arc::new(AsyncMutex::new(HashMap::new())),
            prepare_state: Arc::new(AsyncMutex::new(PrepareState::default())),
        }
    }

    async fn session_lifecycle_gate(&self, session_id: &str) -> Arc<AsyncMutex<()>> {
        let mut gates = self.session_lifecycle_gates.lock().await;
        Arc::clone(
            gates
                .entry(session_id.to_string())
                .or_insert_with(|| Arc::new(AsyncMutex::new(()))),
        )
    }

    pub async fn client(
        &self,
        context: ChatContext,
        tools: &[String],
    ) -> Result<RpcClientLease, String> {
        let tools_key = normalize_tools(tools)?;
        let lifecycle_gate = self.session_lifecycle_gate(&context.session_id).await;
        let _lifecycle_guard = lifecycle_gate.lock().await;
        let existing_to_stop = {
            let mut clients = self.clients.lock().await;
            if let Some(existing) = clients.get(&context.session_id) {
                if existing.is_alive()
                    && existing.context.cwd == context.cwd
                    && existing.tools_key == tools_key
                {
                    return Ok(RpcClientLease::new(Arc::clone(existing), true));
                }
                if existing.is_streaming() || existing.active_operation_count() > 0 {
                    return Err(format!(
                        "Cannot restart session {} with a different directory or tool policy while it is active.",
                        context.session_id
                    ));
                }
            }
            clients.remove(&context.session_id)
        };
        if let Some(existing) = existing_to_stop {
            existing.stop().await?;
        }
        let mapping = self.resumable_mapping(&context.session_id).await?;
        let binary = self.runtime.resolve_binary(&self.environment)?.path;
        let client = RpcClient::spawn(
            self.app.clone(),
            &binary,
            &self.environment,
            self.logger.clone(),
            context.clone(),
            tools_key,
            Some(self.store.clone()),
            mapping
                .as_ref()
                .map(|mapping| mapping.session_file.as_str()),
            false,
            true,
        )
        .await?;
        let lease = RpcClientLease::new(Arc::clone(&client), false);
        self.clients
            .lock()
            .await
            .insert(context.session_id.clone(), client);
        Ok(lease)
    }

    pub async fn begin_prepare(&self, session_id: &str) -> PrepareTicket {
        let mut state = self.prepare_state.lock().await;
        let superseded_session_ids: Vec<_> = state
            .clients
            .keys()
            .filter(|candidate| should_supersede_preparing_client(candidate, session_id))
            .cloned()
            .collect();
        let superseded_clients = superseded_session_ids
            .into_iter()
            .filter_map(|candidate| state.clients.remove(&candidate))
            .collect();
        state.generation = state.generation.wrapping_add(1);
        state.selected_session_id = Some(session_id.to_string());
        PrepareTicket {
            generation: state.generation,
            session_id: session_id.to_string(),
            superseded_clients,
        }
    }

    pub async fn prepare_client(
        &self,
        context: ChatContext,
        tools: &[String],
        ticket: &PrepareTicket,
    ) -> Result<RpcClientLease, String> {
        for client in &ticket.superseded_clients {
            if client.is_alive() {
                client.stop().await?;
            }
        }
        if !self.is_prepare_current(ticket).await {
            return Err(format!(
                "Pi session preparation was superseded before startup: {}",
                ticket.session_id
            ));
        }

        let tools_key = normalize_tools(tools)?;
        let lifecycle_gate = self.session_lifecycle_gate(&context.session_id).await;
        let _lifecycle_guard = lifecycle_gate.lock().await;
        if !self.is_prepare_current(ticket).await {
            return Err(format!(
                "Pi session preparation was superseded while waiting to start: {}",
                ticket.session_id
            ));
        }

        let (existing_to_reuse, existing_to_stop) = {
            let mut clients = self.clients.lock().await;
            if let Some(existing) = clients.get(&context.session_id) {
                if existing.is_alive()
                    && existing.context.cwd == context.cwd
                    && existing.tools_key == tools_key
                {
                    let client = Arc::clone(existing);
                    let lease = RpcClientLease::new(Arc::clone(existing), true);
                    (Some((client, lease)), None)
                } else {
                    if existing.is_streaming() || existing.active_operation_count() > 0 {
                        return Err(format!(
                            "Cannot restart session {} with a different directory or tool policy while it is active.",
                            context.session_id
                        ));
                    }
                    (None, clients.remove(&context.session_id))
                }
            } else {
                (None, None)
            }
        };
        if let Some((client, lease)) = existing_to_reuse {
            if !self.register_preparing_client(ticket, &client).await {
                return Err(format!(
                    "Pi session preparation was superseded before configuration: {}",
                    ticket.session_id
                ));
            }
            return Ok(lease);
        }
        if let Some(existing) = existing_to_stop {
            existing.stop().await?;
        }

        let mapping = self.resumable_mapping(&context.session_id).await?;
        let binary = self.runtime.resolve_binary(&self.environment)?.path;
        let (client, startup_started) = RpcClient::spawn_process(
            self.app.clone(),
            &binary,
            &self.environment,
            self.logger.clone(),
            context.clone(),
            tools_key,
            Some(self.store.clone()),
            mapping
                .as_ref()
                .map(|mapping| mapping.session_file.as_str()),
            false,
            true,
        )
        .await?;
        let lease = RpcClientLease::new(Arc::clone(&client), false);

        if !self.register_preparing_client(ticket, &client).await {
            client.stop().await?;
            return Err(format!(
                "Pi session preparation was superseded during startup: {}",
                ticket.session_id
            ));
        }
        self.clients
            .lock()
            .await
            .insert(context.session_id.clone(), Arc::clone(&client));

        let ready_result = client.wait_until_ready(startup_started).await;
        if let Err(error) = ready_result {
            self.unregister_preparing_client(ticket, &client).await;
            let removed = {
                let mut clients = self.clients.lock().await;
                if clients
                    .get(&context.session_id)
                    .is_some_and(|registered| Arc::ptr_eq(registered, &client))
                {
                    clients.remove(&context.session_id)
                } else {
                    None
                }
            };
            if removed.is_some() && client.is_alive() {
                client.stop().await?;
            }
            return Err(error);
        }
        Ok(lease)
    }

    pub async fn finish_prepare(&self, ticket: &PrepareTicket, client: &RpcClient) {
        self.unregister_preparing_client(ticket, client).await;
    }

    async fn register_preparing_client(
        &self,
        ticket: &PrepareTicket,
        client: &Arc<RpcClient>,
    ) -> bool {
        let mut state = self.prepare_state.lock().await;
        if !prepare_ticket_is_current(&state, ticket) {
            return false;
        }
        state
            .clients
            .insert(ticket.session_id.clone(), Arc::clone(client));
        true
    }

    async fn unregister_preparing_client(&self, ticket: &PrepareTicket, client: &RpcClient) {
        let mut state = self.prepare_state.lock().await;
        if !prepare_ticket_is_current(&state, ticket) {
            return;
        }
        if state
            .clients
            .get(&ticket.session_id)
            .is_some_and(|registered| std::ptr::eq(registered.as_ref(), client))
        {
            state.clients.remove(&ticket.session_id);
        }
    }

    pub async fn is_prepare_current(&self, ticket: &PrepareTicket) -> bool {
        let state = self.prepare_state.lock().await;
        prepare_ticket_is_current(&state, ticket)
    }

    pub async fn ephemeral(&self, cwd: &Path) -> Result<Arc<RpcClient>, String> {
        let binary = self.runtime.resolve_binary(&self.environment)?.path;
        RpcClient::spawn(
            self.app.clone(),
            &binary,
            &self.environment,
            self.logger.clone(),
            ChatContext {
                session_id: format!("ephemeral-{}", uuid::Uuid::new_v4()),
                project_path: cwd.display().to_string(),
                cwd: cwd.to_path_buf(),
            },
            "read,write,edit,bash,grep,find,ls".to_string(),
            None,
            None,
            true,
            false,
        )
        .await
    }

    pub async fn resumable_mapping(
        &self,
        session_id: &str,
    ) -> Result<Option<SessionMapping>, String> {
        let started = Instant::now();
        let mut logged_wait = false;
        loop {
            let Some(mut mapping) = self.store.get(session_id)? else {
                return Ok(None);
            };
            if mapping.ready {
                return Ok(Some(mapping));
            }

            let local_owner_is_alive = self
                .clients
                .lock()
                .await
                .get(session_id)
                .is_some_and(|client| client.is_alive());
            if local_owner_is_alive {
                if !logged_wait {
                    self.logger.record(
                        "info",
                        "session.mapping.lifecycle",
                        "Waiting for the active Pi process to finish materializing its session file",
                        Some(json!({
                            "sessionFile": mapping.session_file,
                            "sessionId": session_id,
                        })),
                    );
                    logged_wait = true;
                }
                if started.elapsed() >= RPC_TIMEOUT {
                    return Err(format!(
                        "Pi session {session_id} did not become resumable within {} seconds: {}",
                        RPC_TIMEOUT.as_secs(),
                        mapping.session_file
                    ));
                }
                sleep(SESSION_MAPPING_POLL_INTERVAL).await;
                continue;
            }

            if !session_file_is_materialized(Path::new(&mapping.session_file))? {
                return Err(format!(
                    "Pi session {session_id} was recorded before its session file materialized, and no owning Pi process is still running: {}",
                    mapping.session_file
                ));
            }
            self.store.mark_ready(session_id, &mapping.session_file)?;
            mapping.ready = true;
            self.logger.record(
                "warn",
                "session.mapping.lifecycle",
                "Recovered a materialized Pi session mapping after an interrupted run",
                Some(json!({
                    "sessionFile": mapping.session_file,
                    "sessionId": session_id,
                })),
            );
            return Ok(Some(mapping));
        }
    }

    pub async fn capture_mapping(&self, client: &RpcClient) -> Result<(), String> {
        let state = client.call(json!({ "type": "get_state" })).await?;
        let session_file = state
            .get("sessionFile")
            .and_then(Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .ok_or_else(|| "Pi did not report a persisted session file.".to_string())?;
        let ready = session_file_is_materialized(Path::new(session_file))?;
        self.store.set(
            &client.context.session_id,
            SessionMapping {
                session_file: session_file.to_string(),
                project_path: client.context.cwd.display().to_string(),
                ready,
            },
        )?;
        if !ready {
            self.logger.record(
                "info",
                "session.mapping.lifecycle",
                "Pi reported a session path that is not materialized yet",
                Some(json!({
                    "sessionFile": session_file,
                    "sessionId": client.context.session_id,
                })),
            );
        }
        Ok(())
    }

    pub async fn release(&self, session_id: &str) -> Result<(), String> {
        let preparing_client = {
            let mut state = self.prepare_state.lock().await;
            if state.selected_session_id.as_deref() == Some(session_id) {
                state.generation = state.generation.wrapping_add(1);
                state.selected_session_id = None;
            }
            state.clients.remove(session_id)
        };
        if let Some(client) = preparing_client {
            if client.is_alive() {
                client.stop().await?;
            }
        }
        let lifecycle_gate = self.session_lifecycle_gate(session_id).await;
        let _lifecycle_guard = lifecycle_gate.lock().await;
        let client = self.clients.lock().await.remove(session_id);
        if let Some(client) = client {
            if client.is_alive() {
                client.stop().await?;
            }
        }
        Ok(())
    }

    pub async fn release_all(&self) -> Result<(), String> {
        let mut clients: Vec<_> = {
            let mut state = self.prepare_state.lock().await;
            state.generation = state.generation.wrapping_add(1);
            state.selected_session_id = None;
            state.clients.drain().map(|(_, client)| client).collect()
        };
        for client in self.clients.lock().await.drain().map(|(_, client)| client) {
            if !clients
                .iter()
                .any(|existing| Arc::ptr_eq(existing, &client))
            {
                clients.push(client);
            }
        }
        for client in clients {
            if client.is_alive() {
                client.stop().await?;
            }
        }
        Ok(())
    }

    pub async fn release_idle_except(&self, session_id: &str) -> Result<usize, String> {
        let (clients, retained_active_clients) = {
            let mut active = self.clients.lock().await;
            let retained_active_clients = active
                .iter()
                .filter(|(id, client)| {
                    id.as_str() != session_id
                        && (client.is_streaming() || client.active_operation_count() > 0)
                })
                .count();
            let removable_ids: Vec<_> = active
                .iter()
                .filter(|(id, client)| {
                    should_release_idle_client(
                        id,
                        session_id,
                        client.is_streaming(),
                        client.active_operation_count(),
                    )
                })
                .map(|(id, _)| id.clone())
                .collect();
            (
                removable_ids
                    .into_iter()
                    .filter_map(|id| active.remove(&id))
                    .collect::<Vec<_>>(),
                retained_active_clients,
            )
        };
        let released = clients.len();
        for client in clients {
            if client.is_alive() {
                client.stop().await?;
            }
        }
        if released > 0 {
            self.logger.record(
                "info",
                "pi.process",
                "Released idle Pi sessions after selection changed",
                Some(json!({
                    "releasedClients": released,
                    "selectedSessionId": session_id,
                })),
            );
        }
        if retained_active_clients > 0 {
            self.logger.record(
                "info",
                "pi.process",
                "Retained active Pi sessions while selection changed",
                Some(json!({
                    "retainedActiveClients": retained_active_clients,
                    "selectedSessionId": session_id,
                })),
            );
        }
        Ok(released)
    }

    pub async fn delete(&self, session_id: &str) -> Result<(), String> {
        self.release(session_id).await?;
        if let Some(mapping) = self.store.remove(session_id)? {
            let path = PathBuf::from(&mapping.session_file);
            if path.exists() {
                std::fs::remove_file(&path).map_err(|error| {
                    format!(
                        "Failed to delete Pi session file {}: {error}",
                        path.display()
                    )
                })?;
            }
        }
        Ok(())
    }

    pub async fn remap_after_fork(
        &self,
        source_session_id: &str,
        target_session_id: &str,
        target_project_path: &Path,
        session_file: &str,
    ) -> Result<(), String> {
        self.store.set(
            target_session_id,
            SessionMapping {
                session_file: session_file.to_string(),
                project_path: target_project_path.display().to_string(),
                ready: true,
            },
        )?;
        self.release(source_session_id).await
    }

    pub async fn update_project_path(
        &self,
        session_id: &str,
        target_project_path: &Path,
    ) -> Result<bool, String> {
        self.release(session_id).await?;
        let Some(mut mapping) = self.store.get(session_id)? else {
            return Ok(false);
        };
        let changed = PathBuf::from(&mapping.project_path) != target_project_path;
        mapping.project_path = target_project_path.display().to_string();
        self.store.set(session_id, mapping)?;
        Ok(changed)
    }

    pub fn mapping(&self, session_id: &str) -> Result<Option<SessionMapping>, String> {
        self.store.get(session_id)
    }

    pub fn environment(&self) -> &ShellEnvironment {
        &self.environment
    }

    pub fn logger(&self) -> &RuntimeLogger {
        &self.logger
    }

    pub fn runtime(&self) -> &PiRuntimeManager {
        &self.runtime
    }
}

fn should_release_idle_client(
    candidate_session_id: &str,
    selected_session_id: &str,
    is_streaming: bool,
    active_operation_count: usize,
) -> bool {
    candidate_session_id != selected_session_id && !is_streaming && active_operation_count == 0
}

fn prepare_ticket_is_current(state: &PrepareState, ticket: &PrepareTicket) -> bool {
    state.generation == ticket.generation
        && state.selected_session_id.as_deref() == Some(ticket.session_id.as_str())
}

fn should_supersede_preparing_client(
    preparing_session_id: &str,
    selected_session_id: &str,
) -> bool {
    preparing_session_id != selected_session_id
}

pub fn tools_for_mode(
    mode: Option<&str>,
    custom: Option<&[String]>,
) -> Result<Vec<String>, String> {
    let all = ["read", "write", "edit", "bash", "grep", "find", "ls"];
    match mode.unwrap_or("standard") {
        "standard" => Ok(all.iter().map(|tool| (*tool).to_string()).collect()),
        "readOnly" => Ok(["read", "grep", "find", "ls"]
            .iter()
            .map(|tool| (*tool).to_string())
            .collect()),
        "noTerminal" => Ok(["read", "write", "edit", "grep", "find", "ls"]
            .iter()
            .map(|tool| (*tool).to_string())
            .collect()),
        "custom" => custom
            .filter(|tools| !tools.is_empty())
            .map(|tools| tools.to_vec())
            .ok_or_else(|| "Custom agent mode requires at least one tool.".to_string()),
        other => Err(format!("Unsupported agent mode: {other}")),
    }
}

fn normalize_tools(tools: &[String]) -> Result<String, String> {
    let allowed = ["read", "write", "edit", "bash", "grep", "find", "ls"];
    let mut normalized = Vec::new();
    for tool in tools {
        if !allowed.contains(&tool.as_str()) {
            return Err(format!("Unsupported Pi tool: {tool}"));
        }
        if !normalized.contains(tool) {
            normalized.push(tool.clone());
        }
    }
    if normalized.is_empty() {
        return Err("At least one Pi tool must be enabled.".to_string());
    }
    Ok(normalized.join(","))
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Pi RPC record is missing {key}."))
}

fn required_bool(value: &Value, key: &str) -> Result<bool, String> {
    value
        .get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("Pi RPC record is missing boolean {key}."))
}

fn event_message_role(value: &Value) -> Result<&str, String> {
    value
        .get("message")
        .and_then(Value::as_object)
        .and_then(|message| message.get("role"))
        .and_then(Value::as_str)
        .ok_or_else(|| "Pi message event is missing message.role.".to_string())
}

fn required_content_index(index: Option<u64>, event_kind: &str) -> Result<u64, String> {
    index.ok_or_else(|| format!("Pi assistant {event_kind} event is missing numeric contentIndex."))
}

fn tool_call_from_partial(
    event: &Map<String, Value>,
    content_index: u64,
) -> Result<Option<ToolCallSnapshot>, String> {
    let index = usize::try_from(content_index)
        .map_err(|_| format!("Pi tool-call contentIndex is too large: {content_index}"))?;
    let block = event
        .get("partial")
        .and_then(|partial| partial.get("content"))
        .and_then(Value::as_array)
        .and_then(|content| content.get(index))
        .ok_or_else(|| {
            format!(
                "Pi tool-call stream event has no partial content block at index {content_index}."
            )
        })?;
    tool_call_snapshot(block, content_index, false)
}

fn final_tool_call(
    event: &Map<String, Value>,
    content_index: u64,
) -> Result<ToolCallSnapshot, String> {
    let block = event.get("toolCall").ok_or_else(|| {
        format!("Pi toolcall_end event at content index {content_index} is missing toolCall.")
    })?;
    tool_call_snapshot(block, content_index, true)?.ok_or_else(|| {
        format!(
            "Pi toolcall_end event at content index {content_index} has no stable tool-call identity."
        )
    })
}

fn tool_call_snapshot(
    block: &Value,
    content_index: u64,
    require_identity: bool,
) -> Result<Option<ToolCallSnapshot>, String> {
    if block.get("type").and_then(Value::as_str) != Some("toolCall") {
        return Err(format!(
            "Pi tool-call stream content at index {content_index} is not a toolCall block."
        ));
    }
    let id = block
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Pi toolCall at content index {content_index} is missing id."))?;
    let name = block
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Pi toolCall at content index {content_index} is missing name."))?;
    let arguments = block.get("arguments").cloned().ok_or_else(|| {
        format!("Pi toolCall at content index {content_index} is missing arguments.")
    })?;
    if id.is_empty() || name.is_empty() {
        if require_identity {
            return Err(format!(
                "Pi toolCall at content index {content_index} has an empty id or name."
            ));
        }
        return Ok(None);
    }
    Ok(Some(ToolCallSnapshot {
        id: id.to_string(),
        name: name.to_string(),
        arguments,
    }))
}

fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

pub fn content_text(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    value
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|block| {
                    if block.get("type").and_then(Value::as_str) == Some("text") {
                        block.get("text").and_then(Value::as_str)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        AgentConfiguration, AssistantStreamState, PrepareState, PrepareTicket, PromptTrace,
        PromptTraceState, ToolCallSnapshot, ToolInputCompletionSource, content_text,
        final_tool_call, prepare_ticket_is_current, required_bool, session_file_is_materialized,
        should_release_idle_client, should_supersede_preparing_client, tool_call_from_partial,
        tools_for_mode,
    };
    use serde_json::{Value, json};
    use std::{fs, time::Instant};

    #[test]
    fn session_materialization_requires_a_regular_file() {
        let root = std::env::temp_dir().join(format!(
            "pi-gui-session-materialization-{}",
            uuid::Uuid::new_v4()
        ));
        let file = root.join("session.jsonl");

        assert!(!session_file_is_materialized(&file).unwrap());
        fs::create_dir_all(&root).unwrap();
        assert!(session_file_is_materialized(&root).is_err());
        fs::write(&file, b"{\"type\":\"session\"}\n").unwrap();
        assert!(session_file_is_materialized(&file).unwrap());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn extracts_text_blocks_without_serializing_non_text_content() {
        assert_eq!(
            content_text(&json!([
                {"type": "text", "text": "one"},
                {"type": "image", "data": "secret"},
                {"type": "text", "text": "two"}
            ])),
            "one\ntwo"
        );
    }

    #[test]
    fn read_only_policy_has_no_mutating_or_terminal_tools() {
        assert_eq!(
            tools_for_mode(Some("readOnly"), None).unwrap(),
            vec!["read", "grep", "find", "ls"]
        );
    }

    #[test]
    fn agent_end_retry_flag_must_be_a_boolean() {
        assert!(required_bool(&json!({"willRetry": "false"}), "willRetry").is_err());
        assert_eq!(
            required_bool(&json!({"willRetry": false}), "willRetry").unwrap(),
            false
        );
    }

    #[test]
    fn prompt_trace_survives_low_level_agent_restarts_until_settled() {
        let mut state = PromptTraceState::default();
        let configuration = AgentConfiguration {
            provider: "provider".to_string(),
            model_id: "model".to_string(),
            thinking_level: "off".to_string(),
            auto_compaction: true,
            auto_retry: true,
        };
        state.register(PromptTrace::new(
            "message-1",
            Instant::now(),
            &configuration,
            true,
        ));

        assert_eq!(state.start_run().unwrap().message_id, "message-1");
        assert_eq!(state.start_run().unwrap().message_id, "message-1");
        assert_eq!(state.settle().unwrap().message_id, "message-1");
        assert!(state.active().is_none());
    }

    #[test]
    fn same_session_preparation_reuses_the_in_flight_client() {
        assert!(!should_supersede_preparing_client("selected", "selected"));
        assert!(should_supersede_preparing_client("old", "selected"));
    }

    #[test]
    fn assistant_stream_ids_include_message_boundaries() {
        let mut state = AssistantStreamState::default();
        state.reset_for_run().unwrap();

        assert_eq!(state.begin_message().unwrap(), 1);
        assert_eq!(state.stream_id(4, "text", 0).unwrap(), "text-4-1-0");
        state.start_tool_input(1).unwrap();
        assert!(state.register_tool_call(1, "call-1").unwrap());
        assert!(!state.register_tool_call(1, "call-1").unwrap());
        state
            .append_tool_input(1, r#"{"command":"printf alpha"}"#)
            .unwrap();
        assert_eq!(
            state.finish_tool_input(1, "call-1", false).unwrap(),
            Some(ToolInputCompletionSource::Json)
        );
        assert_eq!(state.end_message().unwrap(), (1, 1));

        assert_eq!(state.begin_message().unwrap(), 2);
        assert_eq!(state.stream_id(4, "text", 0).unwrap(), "text-4-2-0");
        assert_eq!(state.end_message().unwrap(), (2, 0));
    }

    #[test]
    fn assistant_message_cannot_end_with_incomplete_tool_input() {
        let mut state = AssistantStreamState::default();
        state.begin_message().unwrap();
        state.register_tool_call(2, "call-2").unwrap();

        assert!(state.end_message().unwrap_err().contains("call-2"));
    }

    #[test]
    fn streamed_tool_input_prefers_raw_deltas_for_partial_file_preview() {
        let mut state = AssistantStreamState::default();
        state.begin_message().unwrap();
        state.start_tool_input(0).unwrap();
        state.register_tool_call(0, "write-2").unwrap();

        let first_delta = r#"{"content":"<html>second"#;
        state.append_tool_input(0, first_delta).unwrap();
        assert_eq!(
            state.tool_input_payload(0, &json!({"content": "<html>second"})),
            (Value::String(first_delta.to_string()), "raw_delta")
        );
        assert_eq!(state.finish_tool_input(0, "write-2", false).unwrap(), None);

        let second_delta = r#"</html>","path":"second.html"}"#;
        state.append_tool_input(0, second_delta).unwrap();
        assert_eq!(
            state.finish_tool_input(0, "write-2", false).unwrap(),
            Some(ToolInputCompletionSource::Json)
        );
        assert_eq!(state.finish_tool_input(0, "write-2", true).unwrap(), None);
        assert_eq!(
            state.tool_input_diagnostics(0),
            (first_delta.len() + second_delta.len(), 2)
        );
        assert_eq!(state.end_message().unwrap(), (1, 1));
    }

    #[test]
    fn consecutive_tool_messages_reset_content_indexes_independently() {
        let mut state = AssistantStreamState::default();
        for (sequence, tool_call_id) in ["write-1", "write-2", "write-3"].iter().enumerate() {
            assert_eq!(state.begin_message().unwrap(), sequence as u64 + 1);
            state.start_tool_input(0).unwrap();
            assert!(state.register_tool_call(0, tool_call_id).unwrap());
            let arguments =
                format!(r#"{{"content":"page {sequence}","path":"{tool_call_id}.html"}}"#);
            state.append_tool_input(0, &arguments).unwrap();
            assert_eq!(
                state.tool_input_payload(0, &json!({})),
                (Value::String(arguments), "raw_delta")
            );
            assert_eq!(
                state.finish_tool_input(0, tool_call_id, false).unwrap(),
                Some(ToolInputCompletionSource::Json)
            );
            assert_eq!(state.end_message().unwrap(), (sequence as u64 + 1, 1));
        }
    }

    #[test]
    fn invalid_incremental_json_waits_for_authoritative_toolcall_end() {
        let mut state = AssistantStreamState::default();
        state.begin_message().unwrap();
        state.start_tool_input(0).unwrap();
        state.register_tool_call(0, "write-invalid").unwrap();
        state.append_tool_input(0, "{]").unwrap();
        assert_eq!(
            state.finish_tool_input(0, "write-invalid", false).unwrap(),
            None
        );
        assert_eq!(
            state.finish_tool_input(0, "write-invalid", true).unwrap(),
            Some(ToolInputCompletionSource::ToolcallEnd)
        );
    }

    #[test]
    fn tool_input_scanner_ignores_code_braces_inside_json_strings() {
        let mut state = AssistantStreamState::default();
        state.begin_message().unwrap();
        state.start_tool_input(0).unwrap();
        state.register_tool_call(0, "large-write").unwrap();
        let arguments = serde_json::to_string(&json!({
            "content": "function render() { return { nested: true }; }",
            "path": "large.ts",
        }))
        .unwrap();
        let mut completion = None;
        for character in arguments.chars() {
            state.append_tool_input(0, &character.to_string()).unwrap();
            completion =
                completion.or_else(|| state.finish_tool_input(0, "large-write", false).unwrap());
        }
        assert_eq!(completion, Some(ToolInputCompletionSource::Json));
    }

    #[test]
    fn extracts_streaming_and_final_tool_call_snapshots() {
        let partial = json!({
            "partial": {
                "content": [
                    {"type": "text", "text": "checking"},
                    {
                        "type": "toolCall",
                        "id": "call-1",
                        "name": "bash",
                        "arguments": {"command": "sw_vers"}
                    }
                ]
            }
        });
        let expected = ToolCallSnapshot {
            id: "call-1".to_string(),
            name: "bash".to_string(),
            arguments: json!({"command": "sw_vers"}),
        };
        assert_eq!(
            tool_call_from_partial(partial.as_object().unwrap(), 1).unwrap(),
            Some(expected)
        );

        let final_event = json!({
            "toolCall": {
                "type": "toolCall",
                "id": "call-2",
                "name": "read",
                "arguments": {"path": "AGENTS.md"}
            }
        });
        assert_eq!(
            final_tool_call(final_event.as_object().unwrap(), 3).unwrap(),
            ToolCallSnapshot {
                id: "call-2".to_string(),
                name: "read".to_string(),
                arguments: json!({"path": "AGENTS.md"}),
            }
        );
    }

    #[test]
    fn selection_change_only_releases_truly_idle_clients() {
        assert!(should_release_idle_client("old", "selected", false, 0));
        assert!(!should_release_idle_client(
            "selected", "selected", false, 0
        ));
        assert!(!should_release_idle_client("running", "selected", true, 0));
        assert!(!should_release_idle_client(
            "preparing",
            "selected",
            false,
            1
        ));
    }

    #[test]
    fn only_the_latest_prepare_ticket_is_current() {
        let mut state = PrepareState {
            generation: 1,
            selected_session_id: Some("first".to_string()),
            clients: Default::default(),
        };
        let first = PrepareTicket {
            generation: 1,
            session_id: "first".to_string(),
            superseded_clients: Vec::new(),
        };
        assert!(prepare_ticket_is_current(&state, &first));

        state.generation = 2;
        state.selected_session_id = Some("second".to_string());
        let second = PrepareTicket {
            generation: 2,
            session_id: "second".to_string(),
            superseded_clients: Vec::new(),
        };
        assert!(!prepare_ticket_is_current(&state, &first));
        assert!(prepare_ticket_is_current(&state, &second));
    }
}

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager};

use crate::{logging::RuntimeLogger, paths::expand_home};

const APP_STATE_FILE: &str = "app-state.json";
const SESSION_MAP_FILE: &str = "pi-sessions.json";

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create app data directory {}: {error}",
            directory.display()
        )
    })?;
    Ok(directory)
}

pub fn load_app_state_file(app: &AppHandle) -> Result<Option<Value>, String> {
    let path = app_data_dir(app)?.join(APP_STATE_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let state: Value = serde_json::from_str(&contents)
        .map_err(|error| format!("Invalid JSON in {}: {error}", path.display()))?;
    validate_app_state(&state)?;
    Ok(Some(state))
}

pub fn save_app_state_file(app: &AppHandle, state: &Value) -> Result<(), String> {
    validate_app_state(state)?;
    let path = app_data_dir(app)?.join(APP_STATE_FILE);
    write_json_atomic(&path, state)
}

fn validate_app_state(state: &Value) -> Result<(), String> {
    let object = state
        .as_object()
        .ok_or_else(|| "App state must be a JSON object.".to_string())?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(2) {
        return Err("App state must use schemaVersion 2.".to_string());
    }
    let sessions = object
        .get("sessions")
        .and_then(Value::as_array)
        .ok_or_else(|| "App state is missing sessions.".to_string())?;
    for session in sessions {
        if session.get("agentProvider").and_then(Value::as_str) != Some("pi") {
            return Err("Every persisted session must use the Pi provider.".to_string());
        }
    }
    for required in ["settings", "projects", "shellLayout", "windowState"] {
        if !object.contains_key(required) {
            return Err(format!("App state is missing {required}."));
        }
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub struct ChatContext {
    pub session_id: String,
    pub project_path: String,
    pub cwd: PathBuf,
}

pub fn resolve_chat_context(
    app: &AppHandle,
    session_id: &str,
    supplied_project_path: &str,
) -> Result<ChatContext, String> {
    if session_id.trim().is_empty() {
        return Err("Session id cannot be empty.".to_string());
    }
    let state = load_app_state_file(app)?
        .ok_or_else(|| "App state has not been initialized yet.".to_string())?;
    let sessions = state["sessions"]
        .as_array()
        .ok_or_else(|| "App state sessions must be an array.".to_string())?;
    let session = sessions
        .iter()
        .find(|session| session.get("id").and_then(Value::as_str) == Some(session_id))
        .ok_or_else(|| format!("Unknown session: {session_id}"))?;
    if session.get("archivedAt").is_some() {
        return Err(format!("Archived session cannot run Pi: {session_id}"));
    }
    if session.get("agentProvider").and_then(Value::as_str) != Some("pi") {
        return Err(format!("Session {session_id} does not use Pi."));
    }

    let configured_path = match session.get("projectId").and_then(Value::as_str) {
        Some(project_id) => state["projects"]
            .as_array()
            .and_then(|projects| {
                projects
                    .iter()
                    .find(|project| project.get("id").and_then(Value::as_str) == Some(project_id))
            })
            .and_then(|project| project.get("path"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                format!("Session {session_id} references unknown project {project_id}.")
            })?,
        None => session
            .get("workingDirectory")
            .and_then(Value::as_str)
            .or_else(|| {
                state["settings"]
                    .get("defaultSessionDir")
                    .and_then(Value::as_str)
            })
            .ok_or_else(|| {
                "Session and app settings are missing a default working directory.".to_string()
            })?,
    };

    let cwd = absolute_normalized(&expand_home(configured_path)?)?;
    let supplied = absolute_normalized(&expand_home(supplied_project_path)?)?;
    if cwd != supplied {
        return Err(format!(
            "Rejected mismatched project path for session {session_id}: expected {}, received {}.",
            cwd.display(),
            supplied.display()
        ));
    }
    if session.get("projectId").is_none() {
        fs::create_dir_all(&cwd).map_err(|error| {
            format!(
                "Failed to create default session directory {}: {error}",
                cwd.display()
            )
        })?;
    }
    let metadata = fs::metadata(&cwd).map_err(|error| {
        format!(
            "Working directory {} is unavailable: {error}",
            cwd.display()
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!(
            "Working directory is not a directory: {}",
            cwd.display()
        ));
    }

    Ok(ChatContext {
        session_id: session_id.to_string(),
        project_path: supplied_project_path.to_string(),
        cwd,
    })
}

fn absolute_normalized(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("Failed to resolve current directory: {error}"))?
            .join(path)
    };
    Ok(normalize_lexically(&absolute))
}

fn normalize_lexically(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMapping {
    pub session_file: String,
    pub project_path: String,
    #[serde(default = "session_mapping_ready_default")]
    pub ready: bool,
}

fn session_mapping_ready_default() -> bool {
    true
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionMapFile {
    schema_version: u32,
    sessions: HashMap<String, SessionMapping>,
}

#[derive(Clone)]
pub struct SessionStore {
    path: Arc<PathBuf>,
    sessions: Arc<Mutex<HashMap<String, SessionMapping>>>,
    logger: RuntimeLogger,
}

impl SessionStore {
    pub fn initialize(app: &AppHandle, logger: RuntimeLogger) -> Result<Self, String> {
        let path = app_data_dir(app)?.join(SESSION_MAP_FILE);
        let sessions = if path.exists() {
            let contents = fs::read_to_string(&path)
                .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
            let decoded: SessionMapFile = serde_json::from_str(&contents)
                .map_err(|error| format!("Invalid JSON in {}: {error}", path.display()))?;
            if decoded.schema_version != 1 {
                return Err(format!(
                    "Unsupported Pi session map schema {} in {}.",
                    decoded.schema_version,
                    path.display()
                ));
            }
            for (id, mapping) in &decoded.sessions {
                if id.trim().is_empty() || mapping.session_file.trim().is_empty() {
                    return Err(format!("Invalid Pi session mapping in {}.", path.display()));
                }
            }
            decoded.sessions
        } else {
            HashMap::new()
        };
        Ok(Self {
            path: Arc::new(path),
            sessions: Arc::new(Mutex::new(sessions)),
            logger,
        })
    }

    pub fn get(&self, session_id: &str) -> Result<Option<SessionMapping>, String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "Pi session map mutex was poisoned.".to_string())?;
        Ok(sessions.get(session_id).cloned())
    }

    pub fn set(&self, session_id: &str, mapping: SessionMapping) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Pi session map mutex was poisoned.".to_string())?;
        if sessions.get(session_id) == Some(&mapping) {
            return Ok(());
        }
        sessions.insert(session_id.to_string(), mapping.clone());
        self.persist(&sessions)?;
        self.logger.record(
            "info",
            "session.mapping",
            "Persisted Pi session mapping",
            Some(serde_json::json!({
                "sessionId": session_id,
                "sessionFile": mapping.session_file,
                "projectPath": mapping.project_path,
                "ready": mapping.ready,
            })),
        );
        Ok(())
    }

    pub fn mark_ready(
        &self,
        session_id: &str,
        expected_session_file: &str,
    ) -> Result<bool, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Pi session map mutex was poisoned.".to_string())?;
        let Some(mapping) = sessions.get_mut(session_id) else {
            return Ok(false);
        };
        if mapping.session_file != expected_session_file {
            return Err(format!(
                "Pi session mapping changed while confirming persistence for {session_id}: expected {expected_session_file}, found {}.",
                mapping.session_file
            ));
        }
        if mapping.ready {
            return Ok(false);
        }
        mapping.ready = true;
        self.persist(&sessions)?;
        self.logger.record(
            "info",
            "session.mapping",
            "Confirmed Pi session mapping is resumable",
            Some(serde_json::json!({
                "sessionFile": expected_session_file,
                "sessionId": session_id,
            })),
        );
        Ok(true)
    }

    pub fn remove(&self, session_id: &str) -> Result<Option<SessionMapping>, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Pi session map mutex was poisoned.".to_string())?;
        let removed = sessions.remove(session_id);
        if removed.is_some() {
            self.persist(&sessions)?;
        }
        Ok(removed)
    }

    fn persist(&self, sessions: &HashMap<String, SessionMapping>) -> Result<(), String> {
        write_json_atomic(
            self.path.as_ref(),
            &SessionMapFile {
                schema_version: 1,
                sessions: sessions.clone(),
            },
        )
    }
}

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {}.", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("state"),
        uuid::Uuid::new_v4()
    ));
    let encoded = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to encode {}: {error}", path.display()))?;
    fs::write(&temporary, encoded)
        .map_err(|error| format!("Failed to write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, path).map_err(|error| {
        let cleanup_error = fs::remove_file(&temporary).err();
        format!(
            "Failed to replace {} atomically: {error}; cleanup error: {cleanup_error:?}",
            path.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{SessionMapping, normalize_lexically};
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn normalizes_dot_segments_without_requiring_the_path_to_exist() {
        assert_eq!(
            normalize_lexically(Path::new("/tmp/one/../two/./three")),
            Path::new("/tmp/two/three")
        );
    }

    #[test]
    fn legacy_session_mappings_are_treated_as_ready() {
        let mapping: SessionMapping = serde_json::from_value(json!({
            "sessionFile": "/tmp/session.jsonl",
            "projectPath": "/tmp/project"
        }))
        .unwrap();

        assert!(mapping.ready);
    }

    #[test]
    fn pending_session_mapping_state_round_trips() {
        let mapping = SessionMapping {
            session_file: "/tmp/session.jsonl".to_string(),
            project_path: "/tmp/project".to_string(),
            ready: false,
        };

        let encoded = serde_json::to_value(&mapping).unwrap();
        assert_eq!(encoded.get("ready"), Some(&json!(false)));
        assert!(
            !serde_json::from_value::<SessionMapping>(encoded)
                .unwrap()
                .ready
        );
    }
}

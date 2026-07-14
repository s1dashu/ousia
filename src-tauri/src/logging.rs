use chrono::Utc;
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager};

const MAX_LOG_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone)]
pub struct RuntimeLogger {
    path: Arc<PathBuf>,
    writer: Arc<Mutex<File>>,
}

impl RuntimeLogger {
    pub fn initialize(app: &AppHandle) -> Result<Self, String> {
        let log_dir = app
            .path()
            .app_log_dir()
            .map_err(|error| format!("Failed to resolve app log directory: {error}"))?;
        fs::create_dir_all(&log_dir)
            .map_err(|error| format!("Failed to create app log directory: {error}"))?;
        let path = log_dir.join("pi-gui.log");
        rotate_if_needed(&path)?;
        let writer = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| format!("Failed to open runtime log {}: {error}", path.display()))?;
        let logger = Self {
            path: Arc::new(path),
            writer: Arc::new(Mutex::new(writer)),
        };
        logger.record("info", "app", "Runtime logger initialized", None);
        Ok(logger)
    }

    pub fn path(&self) -> &Path {
        self.path.as_ref()
    }

    pub fn record(&self, level: &str, scope: &str, message: &str, data: Option<Value>) {
        if let Err(error) = self.try_record(level, scope, message, data) {
            eprintln!("Pi runtime logging failed: {error}");
        }
    }

    fn try_record(
        &self,
        level: &str,
        scope: &str,
        message: &str,
        data: Option<Value>,
    ) -> Result<(), String> {
        let mut entry = json!({
            "timestamp": Utc::now().to_rfc3339(),
            "level": level,
            "scope": scope,
            "message": message,
        });
        if let Some(data) = data {
            entry["data"] = data;
        }
        let encoded = serde_json::to_string(&entry)
            .map_err(|error| format!("Failed to encode runtime log entry: {error}"))?;
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| "Runtime log writer mutex was poisoned".to_string())?;
        writer
            .write_all(encoded.as_bytes())
            .and_then(|_| writer.write_all(b"\n"))
            .and_then(|_| writer.flush())
            .map_err(|error| format!("Failed to append runtime log: {error}"))
    }
}

fn rotate_if_needed(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if metadata.len() < MAX_LOG_BYTES {
        return Ok(());
    }
    let rotated = path.with_extension("log.1");
    if rotated.exists() {
        fs::remove_file(&rotated).map_err(|error| {
            format!(
                "Failed to remove rotated log {}: {error}",
                rotated.display()
            )
        })?;
    }
    fs::rename(path, &rotated).map_err(|error| {
        format!(
            "Failed to rotate runtime log {} to {}: {error}",
            path.display(),
            rotated.display()
        )
    })
}

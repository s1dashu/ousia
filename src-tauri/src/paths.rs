use serde_json::json;
use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    process::Command,
};

use crate::logging::RuntimeLogger;

#[derive(Clone, Debug)]
pub struct ShellEnvironment {
    pub values: HashMap<String, String>,
}

impl ShellEnvironment {
    pub fn load(logger: &RuntimeLogger) -> Result<Self, String> {
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let output = Command::new(&shell)
            .args(["-lic", "env -0"])
            .output()
            .map_err(|error| {
                format!("Failed to read login-shell environment with {shell}: {error}")
            })?;
        if !output.status.success() {
            return Err(format!(
                "Login shell {shell} failed while reading its environment with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let mut values = HashMap::new();
        for record in output.stdout.split(|byte| *byte == 0) {
            if record.is_empty() {
                continue;
            }
            let text = String::from_utf8(record.to_vec())
                .map_err(|error| format!("Login-shell environment was not UTF-8: {error}"))?;
            let Some((key, value)) = text.split_once('=') else {
                continue;
            };
            if is_valid_environment_name(key) {
                values.insert(key.to_string(), value.to_string());
            }
        }
        if !values.contains_key("PATH") {
            return Err(format!("Login shell {shell} did not provide PATH."));
        }
        let mut names: Vec<_> = values.keys().cloned().collect();
        names.sort();
        logger.record(
            "info",
            "shell.environment",
            "Loaded login-shell environment for Pi subprocesses",
            Some(json!({ "shell": shell, "variableNames": names })),
        );
        Ok(Self { values })
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(String::as_str)
    }
}

fn is_valid_environment_name(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

pub fn expand_home(path: &str) -> Result<PathBuf, String> {
    if path == "~" {
        return dirs::home_dir().ok_or_else(|| "Failed to resolve home directory.".to_string());
    }
    if let Some(relative) = path.strip_prefix("~/") {
        return dirs::home_dir()
            .map(|home| home.join(relative))
            .ok_or_else(|| "Failed to resolve home directory.".to_string());
    }
    Ok(PathBuf::from(path))
}

pub fn pi_agent_dir(environment: &ShellEnvironment) -> Result<PathBuf, String> {
    if let Some(path) = environment
        .get("PI_CODING_AGENT_DIR")
        .filter(|path| !path.trim().is_empty())
    {
        return expand_home(path);
    }
    dirs::home_dir()
        .map(|home| home.join(".pi").join("agent"))
        .ok_or_else(|| "Failed to resolve Pi agent directory.".to_string())
}

pub const PI_NOT_FOUND_MESSAGE: &str = "Pi was not found in the login-shell PATH or the active npm global prefix. Install Pi or select its executable.";

pub fn find_pi_binary(environment: &ShellEnvironment) -> Result<Option<PathBuf>, String> {
    if let Some(override_path) = environment.get("PI_GUI_PI_PATH") {
        let path = expand_home(override_path)?;
        return require_executable(path, "PI_GUI_PI_PATH").map(Some);
    }
    if let Ok(override_path) = env::var("PI_GUI_PI_PATH") {
        if !override_path.trim().is_empty() {
            let path = expand_home(&override_path)?;
            return require_executable(path, "PI_GUI_PI_PATH").map(Some);
        }
    }

    if let Some(path_value) = environment.get("PATH") {
        for directory in env::split_paths(path_value) {
            let candidate = directory.join(executable_name());
            if is_executable(&candidate) {
                return Ok(Some(candidate));
            }
        }
    }

    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin").join(executable_name()),
        PathBuf::from("/usr/local/bin").join(executable_name()),
    ];
    if let Some(home) = dirs::home_dir() {
        candidates.extend([
            home.join(".local/bin").join(executable_name()),
            home.join(".bun/bin").join(executable_name()),
            home.join(".npm-global/bin").join(executable_name()),
        ]);
    }
    if let Some(candidate) = candidates.into_iter().find(|path| is_executable(path)) {
        return Ok(Some(candidate));
    }

    if let Some(npm) = resolve_command(environment, npm_executable_name()) {
        let output = Command::new(&npm)
            .args(["prefix", "--global"])
            .envs(&environment.values)
            .output()
            .map_err(|error| {
                format!(
                    "Failed to inspect the global npm prefix with {}: {error}",
                    npm.display()
                )
            })?;
        if !output.status.success() {
            return Err(format!(
                "{} prefix --global failed with {}: {}",
                npm.display(),
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let prefix = String::from_utf8(output.stdout)
            .map_err(|error| format!("npm prefix output was not UTF-8: {error}"))?;
        let candidate = PathBuf::from(prefix.trim())
            .join("bin")
            .join(executable_name());
        if is_executable(&candidate) {
            return Ok(Some(candidate));
        }
    }

    Ok(None)
}

pub fn resolve_pi_binary(environment: &ShellEnvironment) -> Result<PathBuf, String> {
    find_pi_binary(environment)?.ok_or_else(|| PI_NOT_FOUND_MESSAGE.to_string())
}

pub(crate) fn executable_name() -> &'static str {
    if cfg!(windows) { "pi.exe" } else { "pi" }
}

fn npm_executable_name() -> &'static str {
    if cfg!(windows) { "npm.cmd" } else { "npm" }
}

pub(crate) fn resolve_command(
    environment: &ShellEnvironment,
    command_name: &str,
) -> Option<PathBuf> {
    environment.get("PATH").and_then(|path_value| {
        env::split_paths(path_value)
            .map(|directory| directory.join(command_name))
            .find(|path| is_executable(path))
    })
}

pub(crate) fn require_executable(path: PathBuf, source: &str) -> Result<PathBuf, String> {
    if is_executable(&path) {
        Ok(path)
    } else {
        Err(format!(
            "{source} points to a missing or non-executable Pi binary: {}",
            path.display()
        ))
    }
}

pub(crate) fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

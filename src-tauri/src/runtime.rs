use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio::{
    process::Command,
    sync::Mutex as AsyncMutex,
    time::{Duration, timeout},
};

use crate::{
    logging::RuntimeLogger,
    paths::{
        ShellEnvironment, executable_name, require_executable, resolve_command, resolve_pi_binary,
    },
    state::{app_data_dir, write_json_atomic},
};
use tauri::AppHandle;

const RUNTIME_STATE_FILE: &str = "pi-runtime.json";
const MANAGED_RUNTIME_DIRECTORY: &str = "pi-runtime/npm";
const PI_PACKAGE: &str = "@earendil-works/pi-coding-agent";
const MINIMUM_NODE_MAJOR: u32 = 22;
const MINIMUM_NODE_MINOR: u32 = 19;
const PATH_MARKER_BLOCK: &str = "# >>> Pi GUI managed PATH >>>\nexport PATH=\"$HOME/.local/bin:$PATH\"\n# <<< Pi GUI managed PATH <<<";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManagedInstallReceipt {
    binary_path: PathBuf,
    installed_at: String,
    package: String,
    prefix: PathBuf,
    version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PathIntegrationReceipt {
    bin_directory_existed: bool,
    link_path: PathBuf,
    shell_config_path: Option<PathBuf>,
    shell_separator: Option<ShellSeparator>,
    target_path: PathBuf,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ShellSeparator {
    DoubleNewline,
    Newline,
    None,
}

impl ShellSeparator {
    fn as_str(self) -> &'static str {
        match self {
            Self::DoubleNewline => "\n\n",
            Self::Newline => "\n",
            Self::None => "",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeStateFile {
    managed_install: Option<ManagedInstallReceipt>,
    path_integration: Option<PathIntegrationReceipt>,
    schema_version: u32,
    selected_binary_path: Option<PathBuf>,
    selected_source: Option<SelectedSource>,
}

impl Default for RuntimeStateFile {
    fn default() -> Self {
        Self {
            managed_install: None,
            path_integration: None,
            schema_version: 1,
            selected_binary_path: None,
            selected_source: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum SelectedSource {
    Managed,
    Selected,
}

impl SelectedSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Managed => "managed",
            Self::Selected => "selected",
        }
    }
}

#[derive(Clone, Debug)]
pub struct ResolvedPiBinary {
    pub path: PathBuf,
    pub source: &'static str,
}

#[derive(Clone, Debug)]
pub struct InstallPrerequisites {
    pub error: Option<String>,
    pub node_path: Option<PathBuf>,
    pub node_version: Option<String>,
    pub npm_path: Option<PathBuf>,
    pub npm_version: Option<String>,
}

#[derive(Clone)]
pub struct PiRuntimeManager {
    logger: RuntimeLogger,
    managed_prefix: Arc<PathBuf>,
    operation: Arc<AsyncMutex<()>>,
    state: Arc<Mutex<RuntimeStateFile>>,
    state_path: Arc<PathBuf>,
}

impl PiRuntimeManager {
    pub fn initialize(app: &AppHandle, logger: RuntimeLogger) -> Result<Self, String> {
        let app_data = app_data_dir(app)?;
        let state_path = app_data.join(RUNTIME_STATE_FILE);
        let managed_prefix = app_data.join(MANAGED_RUNTIME_DIRECTORY);
        let state = if state_path.exists() {
            let contents = fs::read_to_string(&state_path)
                .map_err(|error| format!("Failed to read {}: {error}", state_path.display()))?;
            let decoded: RuntimeStateFile = serde_json::from_str(&contents)
                .map_err(|error| format!("Invalid JSON in {}: {error}", state_path.display()))?;
            validate_state(&decoded, &managed_prefix, &state_path)?;
            decoded
        } else {
            RuntimeStateFile::default()
        };
        logger.record(
            "info",
            "pi.runtime",
            "Loaded Pi runtime ownership state",
            Some(json!({
                "hasManagedInstall": state.managed_install.is_some(),
                "hasPathIntegration": state.path_integration.is_some(),
                "selectedBinaryPath": state.selected_binary_path,
                "statePath": state_path,
            })),
        );
        Ok(Self {
            logger,
            managed_prefix: Arc::new(managed_prefix),
            operation: Arc::new(AsyncMutex::new(())),
            state: Arc::new(Mutex::new(state)),
            state_path: Arc::new(state_path),
        })
    }

    pub fn resolve_binary(
        &self,
        environment: &ShellEnvironment,
    ) -> Result<ResolvedPiBinary, String> {
        // An explicit process/login-shell override remains authoritative for development and CI.
        if environment
            .get("PI_GUI_PI_PATH")
            .is_some_and(|path| !path.trim().is_empty())
            || std::env::var("PI_GUI_PI_PATH").is_ok_and(|path| !path.trim().is_empty())
        {
            return resolve_pi_binary(environment).map(|path| ResolvedPiBinary {
                path,
                source: "override",
            });
        }
        let selected = self
            .state
            .lock()
            .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?
            .selected_binary_path
            .clone();
        if let Some(path) = selected {
            let path = require_executable(path, "Saved Pi runtime selection")?;
            let source = self
                .state
                .lock()
                .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?
                .selected_source
                .map(SelectedSource::as_str)
                .ok_or_else(|| "Saved Pi runtime selection is missing its source.".to_string())?;
            return Ok(ResolvedPiBinary { path, source });
        }
        resolve_pi_binary(environment).map(|path| ResolvedPiBinary {
            source: if binary_is_on_path(environment, &path) {
                "path"
            } else {
                "detected"
            },
            path,
        })
    }

    pub fn ownership_status(&self) -> Result<Value, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?;
        Ok(json!({
            "isManagedInstall": state.managed_install.is_some(),
            "isPathManaged": state.path_integration.is_some(),
            "managedBinaryPath": state.managed_install.as_ref().map(|receipt| &receipt.binary_path),
            "pathLinkPath": state.path_integration.as_ref().map(|receipt| &receipt.link_path),
            "shellConfigPath": state.path_integration.as_ref().and_then(|receipt| receipt.shell_config_path.as_ref()),
        }))
    }

    pub async fn prerequisites(&self, environment: &ShellEnvironment) -> InstallPrerequisites {
        let node_path = resolve_command(environment, executable_for("node"));
        let npm_path = resolve_command(environment, executable_for("npm"));
        let mut result = InstallPrerequisites {
            error: None,
            node_path: node_path.clone(),
            node_version: None,
            npm_path: npm_path.clone(),
            npm_version: None,
        };
        let Some(node_path) = node_path else {
            result.error = Some(
                "Node.js was not found in the login-shell PATH. Pi requires Node.js 22.19 or newer."
                    .to_string(),
            );
            return result;
        };
        let Some(npm_path) = npm_path else {
            result.error = Some(
                "npm was not found in the login-shell PATH. Install npm before installing Pi."
                    .to_string(),
            );
            return result;
        };
        match command_version(&node_path, environment).await {
            Ok(version) => {
                match parse_node_version(&version) {
                    Ok((major, minor))
                        if major > MINIMUM_NODE_MAJOR
                            || (major == MINIMUM_NODE_MAJOR && minor >= MINIMUM_NODE_MINOR) => {}
                    Ok(_) => {
                        result.error = Some(format!(
                            "Node.js {version} is too old. Pi requires Node.js {MINIMUM_NODE_MAJOR}.{MINIMUM_NODE_MINOR} or newer."
                        ));
                    }
                    Err(error) => result.error = Some(error),
                }
                result.node_version = Some(version);
            }
            Err(error) => result.error = Some(error),
        }
        match command_version(&npm_path, environment).await {
            Ok(version) => result.npm_version = Some(version),
            Err(error) if result.error.is_none() => result.error = Some(error),
            Err(_) => {}
        }
        result
    }

    pub async fn select_binary(
        &self,
        environment: &ShellEnvironment,
        path: PathBuf,
    ) -> Result<Value, String> {
        let _operation = self.operation.lock().await;
        if !path.is_absolute() {
            return Err(format!(
                "Selected Pi executable path must be absolute: {}",
                path.display()
            ));
        }
        let canonical = fs::canonicalize(&path)
            .map_err(|error| format!("Failed to resolve {}: {error}", path.display()))?;
        require_executable(canonical.clone(), "Selected Pi executable")?;
        let version = pi_version(&canonical, environment).await?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?;
        if state
            .path_integration
            .as_ref()
            .is_some_and(|receipt| receipt.target_path != canonical)
        {
            return Err(
                "Remove the existing managed shell PATH integration before selecting a different Pi executable."
                    .to_string(),
            );
        }
        state.selected_binary_path = Some(canonical.clone());
        state.selected_source = Some(SelectedSource::Selected);
        self.persist(&state)?;
        self.logger.record(
            "info",
            "pi.runtime",
            "Selected an existing Pi executable",
            Some(json!({ "binaryPath": canonical, "version": version })),
        );
        Ok(json!({ "binaryPath": canonical, "version": version }))
    }

    pub async fn install(&self, environment: &ShellEnvironment) -> Result<Value, String> {
        let _operation = self.operation.lock().await;
        {
            let state = self
                .state
                .lock()
                .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?;
            if state.managed_install.is_some() {
                return Err("This app already owns a managed Pi installation.".to_string());
            }
            if state.path_integration.is_some() {
                return Err(
                    "Remove the existing managed shell PATH integration before installing a managed Pi runtime."
                        .to_string(),
                );
            }
        }
        if self.managed_prefix.exists() {
            return Err(format!(
                "Untracked managed runtime directory already exists at {}. Remove or inspect it before retrying.",
                self.managed_prefix.display()
            ));
        }
        let prerequisites = self.prerequisites(environment).await;
        if let Some(error) = prerequisites.error {
            return Err(error);
        }
        let npm = prerequisites
            .npm_path
            .ok_or_else(|| "Install preflight passed without an npm path.".to_string())?;
        let parent = self
            .managed_prefix
            .parent()
            .ok_or_else(|| "Managed Pi prefix has no parent directory.".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
        self.logger.record(
            "info",
            "pi.runtime.install",
            "Installing Pi into the application-owned npm prefix",
            Some(json!({
                "npmPath": npm,
                "package": PI_PACKAGE,
                "prefix": self.managed_prefix,
            })),
        );
        let mut command = Command::new(&npm);
        command
            .args([
                "install",
                "--global",
                "--prefix",
                self.managed_prefix
                    .to_str()
                    .ok_or_else(|| "Managed Pi prefix is not UTF-8.".to_string())?,
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                PI_PACKAGE,
            ])
            .envs(&environment.values)
            .kill_on_drop(true);
        let output = match timeout(Duration::from_secs(600), command.output()).await {
            Ok(Ok(output)) => output,
            Ok(Err(error)) => {
                return Err(self
                    .cleanup_failed_install(format!("Failed to start {}: {error}", npm.display())));
            }
            Err(_) => {
                return Err(self.cleanup_failed_install(
                    "Pi installation timed out after 600 seconds.".to_string(),
                ));
            }
        };
        let stdout = bounded_output(&output.stdout);
        let stderr = bounded_output(&output.stderr);
        if !output.status.success() {
            self.logger.record(
                "error",
                "pi.runtime.install",
                "npm failed to install Pi",
                Some(json!({
                    "status": output.status.to_string(),
                    "stdout": stdout,
                    "stderr": stderr,
                })),
            );
            return Err(self.cleanup_failed_install(format!(
                "Pi installation failed with {}: {}",
                output.status,
                if stderr.is_empty() { stdout } else { stderr }
            )));
        }
        let binary = managed_binary_path(&self.managed_prefix);
        let version = match pi_version(&binary, environment).await {
            Ok(version) => version,
            Err(error) => return Err(self.cleanup_failed_install(error)),
        };
        let receipt = ManagedInstallReceipt {
            binary_path: binary.clone(),
            installed_at: Utc::now().to_rfc3339(),
            package: PI_PACKAGE.to_string(),
            prefix: self.managed_prefix.as_ref().clone(),
            version: version.clone(),
        };
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?;
        state.managed_install = Some(receipt);
        state.selected_binary_path = Some(binary.clone());
        state.selected_source = Some(SelectedSource::Managed);
        if let Err(error) = self.persist(&state) {
            state.managed_install = None;
            state.selected_binary_path = None;
            state.selected_source = None;
            return Err(self.cleanup_failed_install(error));
        }
        self.logger.record(
            "info",
            "pi.runtime.install",
            "Installed and verified application-managed Pi",
            Some(json!({
                "binaryPath": binary,
                "stdout": stdout,
                "version": version,
            })),
        );
        Ok(json!({ "binaryPath": binary, "version": version }))
    }

    pub async fn uninstall(&self) -> Result<Value, String> {
        let _operation = self.operation.lock().await;
        let (receipt, integration, selected_is_managed) = {
            let state = self
                .state
                .lock()
                .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?;
            let receipt = state
                .managed_install
                .clone()
                .ok_or_else(|| "This app does not own a managed Pi installation.".to_string())?;
            validate_managed_receipt(&receipt, &self.managed_prefix)?;
            (
                receipt.clone(),
                state.path_integration.clone(),
                state.selected_binary_path.as_ref() == Some(&receipt.binary_path),
            )
        };
        if !receipt.prefix.exists() {
            return Err(format!(
                "Managed Pi installation directory is missing: {}",
                receipt.prefix.display()
            ));
        }
        if let Some(integration) = integration {
            if integration.target_path == receipt.binary_path {
                self.remove_path_integration_locked(&integration)?;
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?;
                state.path_integration = None;
                self.persist(&state)?;
            }
        }
        fs::remove_dir_all(&receipt.prefix).map_err(|error| {
            format!(
                "Failed to remove managed Pi installation {}: {error}",
                receipt.prefix.display()
            )
        })?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?;
        state.managed_install = None;
        if selected_is_managed {
            state.selected_binary_path = None;
            state.selected_source = None;
        }
        self.persist(&state)?;
        self.logger.record(
            "info",
            "pi.runtime.install",
            "Removed application-managed Pi without touching the user's Pi configuration",
            Some(json!({
                "preservedAgentDirectory": dirs::home_dir().map(|home| home.join(".pi/agent")),
                "removedPrefix": receipt.prefix,
            })),
        );
        Ok(json!({ "ok": true }))
    }

    pub async fn add_to_shell_path(&self, environment: &ShellEnvironment) -> Result<Value, String> {
        let _operation = self.operation.lock().await;
        if self
            .state
            .lock()
            .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?
            .path_integration
            .is_some()
        {
            return Err("This app already manages a shell PATH integration.".to_string());
        }
        let resolved = self.resolve_binary(environment)?;
        let target = require_executable(resolved.path, "Selected Pi executable")?;
        if !target.is_absolute() {
            return Err(format!(
                "Resolved Pi executable path must be absolute: {}",
                target.display()
            ));
        }
        let home =
            dirs::home_dir().ok_or_else(|| "Failed to resolve home directory.".to_string())?;
        let bin_directory = home.join(".local/bin");
        let bin_directory_existed = bin_directory.exists();
        let link_path = bin_directory.join(executable_name());
        if fs::symlink_metadata(&link_path).is_ok() {
            return Err(format!(
                "Refusing to replace existing path entry at {}.",
                link_path.display()
            ));
        }
        let shell_config_path = if directory_is_on_path(environment, &bin_directory) {
            None
        } else {
            Some(shell_config_path(environment, &home)?)
        };
        let shell_update = if let Some(path) = &shell_config_path {
            let existing = if path.exists() {
                fs::read_to_string(path)
                    .map_err(|error| format!("Failed to read {}: {error}", path.display()))?
            } else {
                String::new()
            };
            if existing.contains(PATH_MARKER_BLOCK) {
                return Err(format!(
                    "Found an untracked managed PATH block in {}.",
                    path.display()
                ));
            }
            let (updated, separator) = append_marker_block(&existing);
            Some((path.clone(), updated, separator))
        } else {
            None
        };
        fs::create_dir_all(&bin_directory)
            .map_err(|error| format!("Failed to create {}: {error}", bin_directory.display()))?;
        if let Err(error) = create_symlink(&target, &link_path) {
            let cleanup = cleanup_path_scaffold(&link_path, &bin_directory, bin_directory_existed);
            return Err(format!("{error}; scaffold cleanup errors: {cleanup:?}"));
        }

        let shell_separator = if let Some((path, updated, separator)) = shell_update {
            if let Err(error) = write_text_atomic(&path, &updated) {
                let cleanup =
                    cleanup_path_scaffold(&link_path, &bin_directory, bin_directory_existed);
                return Err(format!("{error}; scaffold cleanup errors: {cleanup:?}"));
            }
            Some(separator)
        } else {
            None
        };
        let receipt = PathIntegrationReceipt {
            bin_directory_existed,
            link_path: link_path.clone(),
            shell_config_path: shell_config_path.clone(),
            shell_separator,
            target_path: target.clone(),
        };
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?;
        state.path_integration = Some(receipt.clone());
        if let Err(error) = self.persist(&state) {
            state.path_integration = None;
            let rollback = self.remove_path_integration_locked(&receipt).err();
            return Err(format!(
                "{error}; failed PATH integration rollback: {rollback:?}"
            ));
        }
        self.logger.record(
            "info",
            "pi.runtime.path",
            "Added the selected Pi executable to the user's shell PATH",
            Some(json!({
                "linkPath": link_path,
                "shellConfigPath": shell_config_path,
                "targetPath": target,
            })),
        );
        Ok(json!({
            "linkPath": link_path,
            "shellConfigPath": shell_config_path,
        }))
    }

    pub async fn remove_from_shell_path(&self) -> Result<Value, String> {
        let _operation = self.operation.lock().await;
        let receipt = self
            .state
            .lock()
            .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?
            .path_integration
            .clone()
            .ok_or_else(|| "This app does not own a shell PATH integration.".to_string())?;
        self.remove_path_integration_locked(&receipt)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Pi runtime state mutex was poisoned.".to_string())?;
        state.path_integration = None;
        self.persist(&state)?;
        self.logger.record(
            "info",
            "pi.runtime.path",
            "Removed the managed shell PATH integration",
            Some(json!({
                "linkPath": receipt.link_path,
                "shellConfigPath": receipt.shell_config_path,
            })),
        );
        Ok(json!({ "ok": true }))
    }

    fn persist(&self, state: &RuntimeStateFile) -> Result<(), String> {
        validate_state(state, &self.managed_prefix, &self.state_path)?;
        write_json_atomic(&self.state_path, state)
    }

    fn cleanup_failed_install(&self, error: String) -> String {
        let cleanup = if self.managed_prefix.exists() {
            fs::remove_dir_all(self.managed_prefix.as_ref()).err()
        } else {
            None
        };
        self.logger.record(
            "error",
            "pi.runtime.install",
            "Managed Pi installation failed",
            Some(json!({ "error": error, "cleanupError": cleanup.as_ref().map(ToString::to_string) })),
        );
        match cleanup {
            Some(cleanup) => {
                format!("{error}; failed to clean the partial installation: {cleanup}")
            }
            None => error,
        }
    }

    fn remove_path_integration_locked(
        &self,
        receipt: &PathIntegrationReceipt,
    ) -> Result<(), String> {
        let metadata = fs::symlink_metadata(&receipt.link_path).map_err(|error| {
            format!(
                "Managed Pi PATH symlink is unavailable at {}: {error}",
                receipt.link_path.display()
            )
        })?;
        if !metadata.file_type().is_symlink() {
            return Err(format!(
                "Refusing to remove non-symlink PATH entry at {}.",
                receipt.link_path.display()
            ));
        }
        let actual_target = fs::read_link(&receipt.link_path).map_err(|error| {
            format!(
                "Failed to inspect PATH symlink {}: {error}",
                receipt.link_path.display()
            )
        })?;
        if actual_target != receipt.target_path {
            return Err(format!(
                "Refusing to remove externally changed PATH symlink {}: expected {}, found {}.",
                receipt.link_path.display(),
                receipt.target_path.display(),
                actual_target.display()
            ));
        }
        let shell_original = if let Some(path) = &receipt.shell_config_path {
            let contents = fs::read_to_string(path)
                .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
            let separator = receipt.shell_separator.ok_or_else(|| {
                "Managed PATH receipt is missing its shell separator.".to_string()
            })?;
            let updated = remove_marker_block(&contents, separator)?;
            if updated.is_empty() && separator == ShellSeparator::None {
                fs::remove_file(path)
                    .map_err(|error| format!("Failed to remove {}: {error}", path.display()))?;
            } else {
                write_text_atomic(path, &updated)?;
            }
            Some((path, contents))
        } else {
            if receipt.shell_separator.is_some() {
                return Err(
                    "Managed PATH receipt has a separator without a shell configuration file."
                        .to_string(),
                );
            }
            None
        };
        if let Err(error) = fs::remove_file(&receipt.link_path) {
            let rollback = shell_original
                .and_then(|(path, contents)| write_text_atomic(path, &contents).err());
            return Err(format!(
                "Failed to remove {}: {error}; shell configuration rollback error: {rollback:?}",
                receipt.link_path.display()
            ));
        }
        if !receipt.bin_directory_existed {
            match fs::remove_dir(
                receipt
                    .link_path
                    .parent()
                    .ok_or_else(|| "Managed PATH link has no parent directory.".to_string())?,
            ) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => {
                    self.logger.record(
                        "info",
                        "pi.runtime.path",
                        "Preserved the PATH directory because it now contains other files",
                        Some(json!({ "directory": receipt.link_path.parent() })),
                    );
                }
                Err(error) => {
                    return Err(format!(
                        "Removed the Pi PATH link but failed to remove its application-created directory: {error}"
                    ));
                }
            }
        }
        Ok(())
    }
}

fn validate_state(
    state: &RuntimeStateFile,
    managed_prefix: &Path,
    state_path: &Path,
) -> Result<(), String> {
    if state.schema_version != 1 {
        return Err(format!(
            "Unsupported Pi runtime schema {} in {}.",
            state.schema_version,
            state_path.display()
        ));
    }
    if state.selected_binary_path.is_some() != state.selected_source.is_some() {
        return Err(format!(
            "Pi runtime selection is incomplete in {}.",
            state_path.display()
        ));
    }
    if let Some(receipt) = &state.managed_install {
        validate_managed_receipt(receipt, managed_prefix)?;
    }
    if let Some(receipt) = &state.path_integration {
        validate_path_receipt(receipt)?;
    }
    if matches!(state.selected_source, Some(SelectedSource::Managed)) {
        let receipt = state.managed_install.as_ref().ok_or_else(|| {
            format!(
                "Managed Pi selection has no install receipt in {}.",
                state_path.display()
            )
        })?;
        if state.selected_binary_path.as_ref() != Some(&receipt.binary_path) {
            return Err(format!(
                "Managed Pi selection does not match its install receipt in {}.",
                state_path.display()
            ));
        }
    }
    Ok(())
}

fn validate_path_receipt(receipt: &PathIntegrationReceipt) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory.".to_string())?;
    let expected_link = home.join(".local/bin").join(executable_name());
    if receipt.link_path != expected_link || !receipt.target_path.is_absolute() {
        return Err("Managed PATH receipt points outside the expected user paths.".to_string());
    }
    match (&receipt.shell_config_path, receipt.shell_separator) {
        (None, None) => {}
        (Some(path), Some(_))
            if path == &home.join(".zprofile") || path == &home.join(".bash_profile") => {}
        _ => {
            return Err(
                "Managed PATH receipt has an invalid shell configuration path or separator."
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn validate_managed_receipt(
    receipt: &ManagedInstallReceipt,
    managed_prefix: &Path,
) -> Result<(), String> {
    if receipt.package != PI_PACKAGE || receipt.prefix != managed_prefix {
        return Err(
            "Managed Pi install receipt does not match the application-owned prefix.".to_string(),
        );
    }
    if receipt.binary_path != managed_binary_path(managed_prefix) {
        return Err(
            "Managed Pi binary receipt points outside the application-owned prefix.".to_string(),
        );
    }
    Ok(())
}

fn managed_binary_path(prefix: &Path) -> PathBuf {
    prefix.join("bin").join(executable_name())
}

fn executable_for(name: &'static str) -> &'static str {
    if cfg!(windows) {
        match name {
            "npm" => "npm.cmd",
            "node" => "node.exe",
            _ => name,
        }
    } else {
        name
    }
}

async fn command_version(
    executable: &Path,
    environment: &ShellEnvironment,
) -> Result<String, String> {
    let output = Command::new(executable)
        .arg("--version")
        .envs(&environment.values)
        .output()
        .await
        .map_err(|error| format!("Failed to run {} --version: {error}", executable.display()))?;
    if !output.status.success() {
        return Err(format!(
            "{} --version failed with {}: {}",
            executable.display(),
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let version = String::from_utf8(output.stdout)
        .map_err(|error| {
            format!(
                "{} version output was not UTF-8: {error}",
                executable.display()
            )
        })?
        .trim()
        .to_string();
    if version.is_empty() {
        return Err(format!(
            "{} --version returned empty output.",
            executable.display()
        ));
    }
    Ok(version)
}

async fn pi_version(binary: &Path, environment: &ShellEnvironment) -> Result<String, String> {
    require_executable(binary.to_path_buf(), "Pi executable")?;
    command_version(binary, environment).await
}

fn parse_node_version(value: &str) -> Result<(u32, u32), String> {
    let normalized = value.trim().strip_prefix('v').unwrap_or(value.trim());
    let mut segments = normalized.split('.');
    let major = segments
        .next()
        .and_then(|part| part.parse().ok())
        .ok_or_else(|| format!("Could not parse Node.js version: {value}"))?;
    let minor = segments
        .next()
        .and_then(|part| part.parse().ok())
        .ok_or_else(|| format!("Could not parse Node.js version: {value}"))?;
    Ok((major, minor))
}

fn binary_is_on_path(environment: &ShellEnvironment, binary: &Path) -> bool {
    environment.get("PATH").is_some_and(|path_value| {
        std::env::split_paths(path_value).any(|directory| {
            let candidate = directory.join(executable_name());
            candidate == binary
                || (candidate.exists()
                    && fs::canonicalize(candidate).ok() == fs::canonicalize(binary).ok())
        })
    })
}

pub fn binary_on_login_path(environment: &ShellEnvironment, binary: &Path) -> bool {
    binary_is_on_path(environment, binary)
}

fn directory_is_on_path(environment: &ShellEnvironment, expected: &Path) -> bool {
    environment.get("PATH").is_some_and(|path_value| {
        std::env::split_paths(path_value).any(|directory| directory == expected)
    })
}

fn shell_config_path(environment: &ShellEnvironment, home: &Path) -> Result<PathBuf, String> {
    let shell = environment
        .get("SHELL")
        .ok_or_else(|| "Login-shell environment did not report SHELL.".to_string())?;
    match Path::new(shell).file_name().and_then(|name| name.to_str()) {
        Some("zsh") => Ok(home.join(".zprofile")),
        Some("bash") => Ok(home.join(".bash_profile")),
        Some(other) => Err(format!(
            "Automatic PATH integration does not support the {other} shell. Select or install Pi still works without changing PATH."
        )),
        None => Err(format!("Could not identify the login shell from {shell}.")),
    }
}

#[cfg(unix)]
fn create_symlink(target: &Path, link: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(target, link).map_err(|error| {
        format!(
            "Failed to create PATH symlink {} -> {}: {error}",
            link.display(),
            target.display()
        )
    })
}

#[cfg(not(unix))]
fn create_symlink(_target: &Path, _link: &Path) -> Result<(), String> {
    Err("Automatic Pi PATH integration is currently supported on macOS and Linux only.".to_string())
}

fn append_marker_block(existing: &str) -> (String, ShellSeparator) {
    if existing.is_empty() {
        return (format!("{PATH_MARKER_BLOCK}\n"), ShellSeparator::None);
    }
    let separator = if existing.ends_with('\n') {
        ShellSeparator::Newline
    } else {
        ShellSeparator::DoubleNewline
    };
    (
        format!("{existing}{}{PATH_MARKER_BLOCK}\n", separator.as_str()),
        separator,
    )
}

fn remove_marker_block(existing: &str, separator: ShellSeparator) -> Result<String, String> {
    let count = existing.matches(PATH_MARKER_BLOCK).count();
    if count != 1 {
        return Err(format!(
            "Expected exactly one managed PATH block, found {count}."
        ));
    }
    let managed_suffix = format!("{}{PATH_MARKER_BLOCK}\n", separator.as_str());
    if !existing.contains(&managed_suffix) {
        return Err("The managed PATH block no longer matches its ownership receipt.".to_string());
    }
    Ok(existing.replacen(&managed_suffix, "", 1))
}

fn write_text_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot resolve parent directory for {}.", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    let permissions = fs::metadata(path)
        .ok()
        .map(|metadata| metadata.permissions());
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("shell"),
        uuid::Uuid::new_v4()
    ));
    fs::write(&temporary, contents)
        .map_err(|error| format!("Failed to write {}: {error}", temporary.display()))?;
    if let Some(permissions) = permissions {
        fs::set_permissions(&temporary, permissions).map_err(|error| {
            let cleanup = fs::remove_file(&temporary).err();
            format!(
                "Failed to preserve permissions for {}: {error}; cleanup error: {cleanup:?}",
                path.display()
            )
        })?;
    }
    fs::rename(&temporary, path).map_err(|error| {
        let cleanup = fs::remove_file(&temporary).err();
        format!(
            "Failed to replace {} atomically: {error}; cleanup error: {cleanup:?}",
            path.display()
        )
    })
}

fn cleanup_path_scaffold(
    link_path: &Path,
    bin_directory: &Path,
    bin_directory_existed: bool,
) -> Vec<String> {
    let mut errors = Vec::new();
    if link_path.exists() || fs::symlink_metadata(link_path).is_ok() {
        if let Err(error) = fs::remove_file(link_path) {
            errors.push(format!("failed to remove {}: {error}", link_path.display()));
        }
    }
    if !bin_directory_existed {
        match fs::remove_dir(bin_directory) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => errors.push(format!(
                "failed to remove application-created {}: {error}",
                bin_directory.display()
            )),
        }
    }
    errors
}

fn bounded_output(bytes: &[u8]) -> String {
    const LIMIT: usize = 64 * 1024;
    let slice = if bytes.len() > LIMIT {
        &bytes[bytes.len() - LIMIT..]
    } else {
        bytes
    };
    String::from_utf8_lossy(slice).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        PATH_MARKER_BLOCK, ShellSeparator, append_marker_block, parse_node_version,
        remove_marker_block,
    };

    #[test]
    fn parses_supported_node_versions() {
        assert_eq!(parse_node_version("v22.19.1").unwrap(), (22, 19));
        assert_eq!(parse_node_version("24.16.0").unwrap(), (24, 16));
        assert!(parse_node_version("unknown").is_err());
    }

    #[test]
    fn path_marker_round_trip_preserves_existing_shell_content() {
        for original in ["", "export EDITOR=vim", "export EDITOR=vim\n"] {
            let (updated, separator) = append_marker_block(original);
            assert!(updated.contains(PATH_MARKER_BLOCK));
            assert_eq!(remove_marker_block(&updated, separator).unwrap(), original);
        }
    }

    #[test]
    fn path_marker_removal_rejects_ambiguous_files() {
        let duplicate = format!("{PATH_MARKER_BLOCK}\n{PATH_MARKER_BLOCK}\n");
        assert!(remove_marker_block(&duplicate, ShellSeparator::None).is_err());
    }
}

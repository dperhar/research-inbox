use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

use super::ttl::TtlManager;

fn log(msg: &str) {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let path = format!("{}/.research-inbox/debug.log", home);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "[sidecar] {}", msg);
        let _ = f.flush();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SidecarState {
    NotReady, // Model not downloaded yet
    Sleeping, // Model on disk, process not running
    Waking,   // Process spawning
    Ready,    // Process running, accepting requests
}

pub struct SidecarManager {
    state: Mutex<SidecarState>,
    model_path: PathBuf,
    process: Mutex<Option<Child>>,
    ttl: TtlManager,
}

impl SidecarManager {
    pub fn new(model_path: PathBuf) -> Self {
        let initial_state = if model_path.exists() {
            SidecarState::Sleeping
        } else {
            SidecarState::NotReady
        };
        log(&format!(
            "new: model_path={:?} initial_state={:?}",
            model_path, initial_state
        ));
        Self {
            state: Mutex::new(initial_state),
            model_path,
            process: Mutex::new(None),
            ttl: TtlManager::new(Duration::from_secs(300)),
        }
    }

    pub fn state(&self) -> SidecarState {
        self.state.lock().unwrap().clone()
    }

    pub fn refresh_model_state(&self) {
        let next = if self.model_path.exists() {
            SidecarState::Sleeping
        } else {
            SidecarState::NotReady
        };
        let mut state = self.state.lock().unwrap();
        if *state != SidecarState::Ready {
            *state = next;
        }
    }

    pub fn ttl_expired(&self) -> bool {
        self.ttl.is_expired()
    }

    /// Ensure the sidecar process is running and ready to accept requests.
    /// - NotReady → error (model file missing)
    /// - Sleeping  → spawn (placeholder until actual binary is wired)
    /// - Waking    → no-op (already in progress)
    /// - Ready     → no-op
    pub fn ensure_ready(&self) -> Result<(), String> {
        self.refresh_model_state();
        let current = self.state.lock().unwrap().clone();
        match current {
            SidecarState::NotReady => {
                log("ensure_ready: model not present, returning error");
                Err("Model not downloaded. Cannot start sidecar.".to_string())
            }
            SidecarState::Sleeping => {
                log("ensure_ready: sleeping → waking");
                *self.state.lock().unwrap() = SidecarState::Waking;

                if !self.model_path.exists() {
                    *self.state.lock().unwrap() = SidecarState::NotReady;
                    log("ensure_ready: model disappeared during spawn");
                    return Err("Model file not found during spawn.".to_string());
                }

                if self.find_runtime_paths().is_err() {
                    *self.state.lock().unwrap() = SidecarState::Sleeping;
                    return Err("llama runtime not available".to_string());
                }

                *self.state.lock().unwrap() = SidecarState::Ready;
                self.ttl.reset();
                log("ensure_ready: state → Ready");
                Ok(())
            }
            SidecarState::Waking => {
                log("ensure_ready: already waking, no-op");
                Ok(())
            }
            SidecarState::Ready => {
                log("ensure_ready: already ready, no-op");
                Ok(())
            }
        }
    }

    /// Kill the running process and transition back to Sleeping (or NotReady
    /// if the model has since been removed).
    pub fn kill(&self) {
        log("kill: stopping process");
        if let Some(mut child) = self.process.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let next = if self.model_path.exists() {
            SidecarState::Sleeping
        } else {
            SidecarState::NotReady
        };
        log(&format!("kill: state → {:?}", next));
        *self.state.lock().unwrap() = next;
    }

    /// Send a JSON line to the sidecar's stdin and read a JSON line from
    /// stdout. Resets the TTL on each call.
    ///
    /// NOTE: stdin/stdout wiring is a placeholder until the real binary is
    /// integrated. For now, returns an error indicating unavailability.
    pub fn request(&self, json_request: &str) -> Result<String, String> {
        if self.state() != SidecarState::Ready {
            return Err("Sidecar not ready".to_string());
        }
        self.ttl.reset();
        log(&format!("request: sending {}", json_request));

        // Placeholder: real implementation writes to Child.stdin and reads
        // from Child.stdout once the llama.cpp binary is wired.
        Err("request: binary not yet wired – placeholder only".to_string())
    }

    /// Run inference synchronously: spawn llama-cli with -p prompt, capture stdout.
    /// The binary is called fresh each time; macOS mmap keeps the model warm
    /// after the first load (~150ms cold, ~40ms subsequent).
    pub fn complete(
        &self,
        prompt: &str,
        max_tokens: u32,
        temperature: f32,
    ) -> Result<String, String> {
        self.refresh_model_state();
        if !self.model_path.exists() {
            return Err("Model not found".to_string());
        }

        self.ttl.reset();

        let (binary, libs_source_dir) = self.find_runtime_paths()?;
        let runtime_lib_dir = self.prepare_runtime_lib_dir(&libs_source_dir)?;
        self.clear_quarantine(Path::new(&binary));
        log(&format!(
            "complete: binary={} libs={}",
            binary, runtime_lib_dir
        ));

        let output = Command::new(&binary)
            .arg("-m")
            .arg(&self.model_path)
            .arg("-no-cnv")
            .arg("--single-turn")
            .arg("--no-display-prompt")
            .arg("-p")
            .arg(prompt)
            .arg("-n")
            .arg(max_tokens.to_string())
            .arg("--temp")
            .arg(temperature.to_string())
            .arg("--log-disable")
            .env("DYLD_LIBRARY_PATH", &runtime_lib_dir)
            .env("DYLD_FALLBACK_LIBRARY_PATH", &runtime_lib_dir)
            .stderr(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("Failed to run llama-cli: {}", e))?;

        if !output.status.success() {
            let msg = format!("llama-cli exited with: {}", output.status);
            log(&msg);
            return Err(msg);
        }

        let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
        log(&format!("complete: got {} chars", result.len()));
        Ok(result)
    }

    fn find_runtime_paths(&self) -> Result<(String, PathBuf), String> {
        let exe = std::env::current_exe().unwrap_or_default();
        let exe_dir = exe.parent().unwrap_or(std::path::Path::new("."));
        let bundle_resources = exe_dir
            .parent()
            .unwrap_or(exe_dir)
            .join("Resources")
            .join("binaries");
        let bundle_binary = bundle_resources.join("llama-cli-aarch64-apple-darwin");
        if bundle_binary.exists() {
            log(&format!(
                "find_runtime_paths: bundle binary {:?}",
                bundle_binary
            ));
            return Ok((
                bundle_binary.to_string_lossy().to_string(),
                bundle_resources,
            ));
        }

        let macos_binary = exe_dir.join("llama-cli");
        if macos_binary.exists() && bundle_resources.exists() {
            log(&format!(
                "find_runtime_paths: MacOS binary {:?} with resources {:?}",
                macos_binary, bundle_resources
            ));
            return Ok((macos_binary.to_string_lossy().to_string(), bundle_resources));
        }

        let dev_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let dev_binary = dev_dir.join("llama-cli-aarch64-apple-darwin");
        if dev_binary.exists() {
            log(&format!("find_runtime_paths: dev path {:?}", dev_binary));
            return Ok((dev_binary.to_string_lossy().to_string(), dev_dir));
        }

        log("find_runtime_paths: not found in bundle or dev paths");
        Err("llama-cli binary not found".to_string())
    }

    fn prepare_runtime_lib_dir(&self, source_dir: &Path) -> Result<String, String> {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let runtime_dir = PathBuf::from(home)
            .join(".research-inbox")
            .join("runtime")
            .join("llama-dylibs");
        std::fs::create_dir_all(&runtime_dir).map_err(|e| e.to_string())?;

        let mapping = [
            ("libmtmd.0.0.8763.dylib", "libmtmd.0.dylib"),
            ("libllama.0.0.8763.dylib", "libllama.0.dylib"),
            ("libggml.0.9.11.dylib", "libggml.0.dylib"),
            ("libggml-cpu.0.9.11.dylib", "libggml-cpu.0.dylib"),
            ("libggml-blas.0.9.11.dylib", "libggml-blas.0.dylib"),
            ("libggml-metal.0.9.11.dylib", "libggml-metal.0.dylib"),
            ("libggml-rpc.0.9.11.dylib", "libggml-rpc.0.dylib"),
            ("libggml-base.0.9.11.dylib", "libggml-base.0.dylib"),
        ];

        for (source_name, target_name) in mapping {
            let source = source_dir.join(source_name);
            let target = runtime_dir.join(target_name);
            if !source.exists() {
                return Err(format!("Runtime library missing: {}", source.display()));
            }
            self.copy_if_needed(&source, &target)?;
            self.clear_quarantine(&target);
        }

        Ok(runtime_dir.to_string_lossy().to_string())
    }

    fn copy_if_needed(&self, source: &Path, target: &Path) -> Result<(), String> {
        let should_copy = match (std::fs::metadata(source), std::fs::metadata(target)) {
            (Ok(src), Ok(dst)) => src.len() != dst.len(),
            (Ok(_), Err(_)) => true,
            (Err(e), _) => return Err(e.to_string()),
        };

        if should_copy {
            std::fs::copy(source, target).map_err(|e| {
                format!(
                    "Failed to stage runtime library {} -> {}: {}",
                    source.display(),
                    target.display(),
                    e
                )
            })?;
        }
        Ok(())
    }

    fn clear_quarantine(&self, path: &Path) {
        let _ = Command::new("xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(path)
            .output();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_state_not_ready_without_model() {
        let mgr = SidecarManager::new("/nonexistent/model.gguf".into());
        assert_eq!(mgr.state(), SidecarState::NotReady);
    }

    #[test]
    fn test_initial_state_sleeping_with_model() {
        let dir = tempfile::tempdir().unwrap();
        let model_path = dir.path().join("model.gguf");
        std::fs::write(&model_path, b"fake").unwrap();
        let mgr = SidecarManager::new(model_path);
        assert_eq!(mgr.state(), SidecarState::Sleeping);
    }

    #[test]
    fn test_ensure_ready_fails_without_model() {
        let mgr = SidecarManager::new("/nonexistent/model.gguf".into());
        assert!(mgr.ensure_ready().is_err());
    }

    #[test]
    fn test_ensure_ready_transitions_to_ready_with_model() {
        let dir = tempfile::tempdir().unwrap();
        let model_path = dir.path().join("model.gguf");
        std::fs::write(&model_path, b"fake").unwrap();
        let mgr = SidecarManager::new(model_path);
        assert!(mgr.ensure_ready().is_ok());
        assert_eq!(mgr.state(), SidecarState::Ready);
    }

    #[test]
    fn test_kill_transitions_to_sleeping() {
        let dir = tempfile::tempdir().unwrap();
        let model_path = dir.path().join("model.gguf");
        std::fs::write(&model_path, b"fake").unwrap();
        let mgr = SidecarManager::new(model_path);
        mgr.kill();
        assert_eq!(mgr.state(), SidecarState::Sleeping);
    }

    #[test]
    fn test_kill_after_ready_returns_to_sleeping() {
        let dir = tempfile::tempdir().unwrap();
        let model_path = dir.path().join("model.gguf");
        std::fs::write(&model_path, b"fake").unwrap();
        let mgr = SidecarManager::new(model_path);
        mgr.ensure_ready().unwrap();
        assert_eq!(mgr.state(), SidecarState::Ready);
        mgr.kill();
        assert_eq!(mgr.state(), SidecarState::Sleeping);
    }

    #[test]
    fn test_ttl_not_expired_after_ensure_ready() {
        let dir = tempfile::tempdir().unwrap();
        let model_path = dir.path().join("model.gguf");
        std::fs::write(&model_path, b"fake").unwrap();
        let mgr = SidecarManager::new(model_path);
        mgr.ensure_ready().unwrap();
        assert!(!mgr.ttl_expired());
    }
}

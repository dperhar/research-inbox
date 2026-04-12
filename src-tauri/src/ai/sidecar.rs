use std::io::Write;
use std::path::PathBuf;
use std::process::Child;
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

    pub fn ttl_expired(&self) -> bool {
        self.ttl.is_expired()
    }

    /// Ensure the sidecar process is running and ready to accept requests.
    /// - NotReady → error (model file missing)
    /// - Sleeping  → spawn (placeholder until actual binary is wired)
    /// - Waking    → no-op (already in progress)
    /// - Ready     → no-op
    pub fn ensure_ready(&self) -> Result<(), String> {
        let current = self.state.lock().unwrap().clone();
        match current {
            SidecarState::NotReady => {
                log("ensure_ready: model not present, returning error");
                Err("Model not downloaded. Cannot start sidecar.".to_string())
            }
            SidecarState::Sleeping => {
                log("ensure_ready: sleeping → waking");
                *self.state.lock().unwrap() = SidecarState::Waking;

                // Placeholder spawn: verify model file still exists, then
                // transition to Ready. Real llama.cpp Command::new() wiring
                // happens when we have the binary.
                if !self.model_path.exists() {
                    *self.state.lock().unwrap() = SidecarState::NotReady;
                    log("ensure_ready: model disappeared during spawn");
                    return Err("Model file not found during spawn.".to_string());
                }

                // Simulated ready – no actual Child process yet.
                *self.state.lock().unwrap() = SidecarState::Ready;
                self.ttl.reset();
                log("ensure_ready: state → Ready (simulated)");
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

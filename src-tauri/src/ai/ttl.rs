use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct TtlManager {
    last_activity: Mutex<Instant>,
    ttl: Duration,
}

impl TtlManager {
    pub fn new(ttl: Duration) -> Self {
        Self {
            last_activity: Mutex::new(Instant::now()),
            ttl,
        }
    }

    pub fn reset(&self) {
        *self.last_activity.lock().unwrap() = Instant::now();
    }

    pub fn is_expired(&self) -> bool {
        self.last_activity.lock().unwrap().elapsed() > self.ttl
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ttl_not_expired_initially() {
        let mgr = TtlManager::new(Duration::from_secs(300));
        assert!(!mgr.is_expired());
    }

    #[test]
    fn test_ttl_reset_extends_lifetime() {
        let mgr = TtlManager::new(Duration::from_millis(50));
        std::thread::sleep(Duration::from_millis(30));
        mgr.reset();
        std::thread::sleep(Duration::from_millis(30));
        assert!(!mgr.is_expired());
    }

    #[test]
    fn test_ttl_expires_after_duration() {
        let mgr = TtlManager::new(Duration::from_millis(20));
        std::thread::sleep(Duration::from_millis(30));
        assert!(mgr.is_expired());
    }
}

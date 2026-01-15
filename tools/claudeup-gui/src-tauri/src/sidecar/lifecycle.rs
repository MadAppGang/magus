use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SidecarState {
    Stopped,
    Starting,
    Ready,
    Crashed,
    Restarting,
    Stopping,
    Failed,
}

pub struct SidecarLifecycle {
    state: Arc<Mutex<SidecarState>>,
}

impl SidecarLifecycle {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(SidecarState::Stopped)),
        }
    }

    pub fn get_state(&self) -> SidecarState {
        *self.state.lock().unwrap()
    }

    pub fn set_state(&self, new_state: SidecarState) {
        let mut state = self.state.lock().unwrap();
        println!("Sidecar state transition: {:?} → {:?}", *state, new_state);
        *state = new_state;
    }
}

impl Default for SidecarLifecycle {
    fn default() -> Self {
        Self::new()
    }
}

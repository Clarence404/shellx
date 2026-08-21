//! Connect-time host-key challenge: TOFU policy that pauses the handshake
//! (oneshot) while the frontend shows the fingerprint dialog.

use crate::hostkeys::{self, Verdict};
use crate::protocol::HostKeyPolicy;
use russh::keys::PublicKey;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;
use uuid::Uuid;

pub struct ChallengeRegistry(pub Mutex<HashMap<Uuid, oneshot::Sender<bool>>>);

impl Default for ChallengeRegistry {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChallengeEvent {
    attempt_id: Uuid,
    host: String,
    port: u16,
    key_type: String,
    fingerprint: String,
    verdict: &'static str,
    stored_fingerprint: Option<String>,
}

/// TOFU host-key policy: checks known_hosts and, for unknown or mismatched
/// keys, emits a `hostkey:challenge` event and waits for the frontend to call
/// `hostkey_respond` before continuing the handshake.
pub struct TofuPolicy {
    pub app: AppHandle,
}

const CHALLENGE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

#[async_trait::async_trait]
impl HostKeyPolicy for TofuPolicy {
    async fn verify(&self, host: &str, port: u16, key: &PublicKey) -> bool {
        let Some(path) = hostkeys::default_path() else {
            crate::log_error!(
                crate::logs::categories::SESSION,
                "no known_hosts path available, refusing the host key",
                "host": host, "port": port,
            );
            return false;
        };
        let verdict = hostkeys::check(host, port, key, &path);
        let (verdict_str, stored): (&'static str, Option<String>) = match verdict {
            Verdict::Match => return true,
            Verdict::Unknown => ("unknown", None),
            Verdict::Mismatch { stored_fingerprint } => ("mismatch", Some(stored_fingerprint)),
        };
        let attempt_id = Uuid::new_v4();
        let (tx, rx) = oneshot::channel::<bool>();
        {
            let registry: State<ChallengeRegistry> = self.app.state();
            registry.0.lock().unwrap().insert(attempt_id, tx);
        }
        let _ = self.app.emit(
            "hostkey:challenge",
            ChallengeEvent {
                attempt_id,
                host: host.to_string(),
                port,
                key_type: key.algorithm().to_string(),
                fingerprint: format!("{}", key.fingerprint(russh::keys::HashAlg::Sha256)),
                verdict: verdict_str,
                stored_fingerprint: stored,
            },
        );
        let accepted = matches!(
            tokio::time::timeout(CHALLENGE_TIMEOUT, rx).await,
            Ok(Ok(true))
        );
        crate::log_warn!(
            crate::logs::categories::SESSION,
            if accepted { "host key accepted by the user" } else { "host key rejected or the prompt timed out" },
            "host": host, "port": port,
            "verdict": verdict_str,
            "key_type": key.algorithm().to_string(),
            "fingerprint": format!("{}", key.fingerprint(russh::keys::HashAlg::Sha256)),
            "accepted": accepted,
        );
        if accepted {
            let _ = hostkeys::learn(host, port, key, &path);
        } else {
            // Clean up the sender if the timeout fired before the user
            // responded (hostkey_respond already removes it on user response).
            let registry: State<ChallengeRegistry> = self.app.state();
            registry.0.lock().unwrap().remove(&attempt_id);
        }
        accepted
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondArgs {
    pub attempt_id: Uuid,
    pub accept: bool,
}

/// Frontend calls this to accept or reject a pending host-key challenge.
#[tauri::command]
pub fn hostkey_respond(args: RespondArgs, registry: State<'_, ChallengeRegistry>) {
    if let Some(tx) = registry.0.lock().unwrap().remove(&args.attempt_id) {
        let _ = tx.send(args.accept);
    }
}

/// Returns the current trusted-hosts list (for the Settings "Trusted servers"
/// view).
#[tauri::command]
pub fn hostkeys_list() -> Vec<hostkeys::TrustedHost> {
    hostkeys::default_path()
        .map(|p| hostkeys::list(&p))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn respond_consumes_pending_entry() {
        let reg = ChallengeRegistry::default();
        let (tx, mut rx) = tokio::sync::oneshot::channel::<bool>();
        let id = Uuid::new_v4();
        reg.0.lock().unwrap().insert(id, tx);
        if let Some(t) = reg.0.lock().unwrap().remove(&id) {
            let _ = t.send(true);
        }
        assert_eq!(rx.try_recv(), Ok(true));
        assert!(reg.0.lock().unwrap().is_empty());
    }
}

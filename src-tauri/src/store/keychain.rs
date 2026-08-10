use crate::error::{Error, Result};
use keyring::Entry;
use uuid::Uuid;

const SERVICE: &str = "shellx";
const PROBE_ACCOUNT: &str = "__shellx_keychain_probe__";
const PROBE_VALUE: &str = "1";

pub struct KeychainStore {
    available: bool,
}

impl KeychainStore {
    pub fn open() -> Self {
        Self { available: probe() }
    }

    pub fn is_available(&self) -> bool {
        self.available
    }

    pub fn set_password(&self, host_id: Uuid, password: &str) -> Result<()> {
        if !self.available {
            return Err(Error::Protocol("keychain unavailable on this system".into()));
        }
        let entry = Entry::new(SERVICE, &host_id.to_string())
            .map_err(|e| Error::Protocol(format!("keychain entry: {e}")))?;
        entry.set_password(password)
            .map_err(|e| Error::Protocol(format!("keychain set: {e}")))?;
        Ok(())
    }

    pub fn get_password(&self, host_id: Uuid) -> Result<Option<String>> {
        if !self.available {
            return Ok(None);
        }
        let entry = Entry::new(SERVICE, &host_id.to_string())
            .map_err(|e| Error::Protocol(format!("keychain entry: {e}")))?;
        match entry.get_password() {
            Ok(pw) => Ok(Some(pw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Error::Protocol(format!("keychain get: {e}"))),
        }
    }

    pub fn delete_password(&self, host_id: Uuid) -> Result<()> {
        if !self.available {
            return Ok(());
        }
        let entry = Entry::new(SERVICE, &host_id.to_string())
            .map_err(|e| Error::Protocol(format!("keychain entry: {e}")))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),  // idempotent
            Err(e) => Err(Error::Protocol(format!("keychain delete: {e}"))),
        }
    }

    pub fn set_passphrase(&self, host_id: Uuid, passphrase: &str) -> Result<()> {
        if !self.available {
            return Err(Error::Protocol("keychain unavailable on this system".into()));
        }
        let entry = Entry::new(SERVICE, &passphrase_account(host_id))
            .map_err(|e| Error::Protocol(format!("keychain entry: {e}")))?;
        entry.set_password(passphrase)
            .map_err(|e| Error::Protocol(format!("keychain set: {e}")))?;
        Ok(())
    }

    pub fn get_passphrase(&self, host_id: Uuid) -> Result<Option<String>> {
        if !self.available {
            return Ok(None);
        }
        let entry = Entry::new(SERVICE, &passphrase_account(host_id))
            .map_err(|e| Error::Protocol(format!("keychain entry: {e}")))?;
        match entry.get_password() {
            Ok(pp) => Ok(Some(pp)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Error::Protocol(format!("keychain get: {e}"))),
        }
    }

    pub fn delete_passphrase(&self, host_id: Uuid) -> Result<()> {
        if !self.available {
            return Ok(());
        }
        let entry = Entry::new(SERVICE, &passphrase_account(host_id))
            .map_err(|e| Error::Protocol(format!("keychain entry: {e}")))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(Error::Protocol(format!("keychain delete: {e}"))),
        }
    }
}

fn passphrase_account(host_id: Uuid) -> String {
    format!("passphrase:{host_id}")
}

fn probe() -> bool {
    let Ok(entry) = Entry::new(SERVICE, PROBE_ACCOUNT) else { return false; };
    let set_ok = entry.set_password(PROBE_VALUE).is_ok();
    if !set_ok { return false; }
    let get_ok = matches!(entry.get_password(), Ok(v) if v == PROBE_VALUE);
    // Clean up regardless
    let _ = entry.delete_credential();
    get_ok
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    // Note: these tests hit the real OS keychain. On CI or headless Linux, is_available()
    // will be false and set/get/delete return None/Ok(()) without touching anything.
    // The tests below check the API contract, not physical keychain behavior.

    #[test]
    fn probe_returns_boolean_without_panicking() {
        let k = KeychainStore::open();
        let _ = k.is_available();  // must not panic on any platform
    }

    #[test]
    fn set_get_delete_roundtrip_or_unavailable() {
        let k = KeychainStore::open();
        let id = Uuid::new_v4();
        if k.is_available() {
            k.set_password(id, "test-pw-v0.2-plan").unwrap();
            assert_eq!(k.get_password(id).unwrap().as_deref(), Some("test-pw-v0.2-plan"));
            k.delete_password(id).unwrap();
            assert!(k.get_password(id).unwrap().is_none());
        } else {
            // On unavailable systems, get returns Ok(None) and delete is Ok(())
            assert!(k.get_password(id).unwrap().is_none());
            k.delete_password(id).unwrap();
            // set_password errors on unavailable
            assert!(k.set_password(id, "x").is_err());
        }
    }

    #[test]
    fn delete_is_idempotent() {
        let k = KeychainStore::open();
        let id = Uuid::new_v4();
        // Not previously set — should still return Ok
        k.delete_password(id).unwrap();
        k.delete_password(id).unwrap();
    }

    #[test]
    fn passphrase_roundtrip_or_unavailable() {
        let k = KeychainStore::open();
        let id = Uuid::new_v4();
        if k.is_available() {
            k.set_passphrase(id, "pp").unwrap();
            assert_eq!(k.get_passphrase(id).unwrap().as_deref(), Some("pp"));
            // must NOT collide with password entry for the same id
            assert!(k.get_password(id).unwrap().is_none());
            k.delete_passphrase(id).unwrap();
        } else {
            // unavailable: all ops still succeed/return None
            assert!(k.get_passphrase(id).unwrap().is_none());
            k.delete_passphrase(id).unwrap();
        }
    }
}

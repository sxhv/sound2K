//! Session token storage in Windows Credential Manager
//! (Control Panel → Credential Manager → Windows Credentials →
//! "soundcloud-session@Sound2K").

use crate::errors::AppResult;
use keyring::Entry;

const SERVICE: &str = "Sound2K";
/// Service name used before the rename to Sound2K.
const LEGACY_SERVICE: &str = "SoundCloudMini";
const ACCOUNT: &str = "soundcloud-session";

fn entry() -> AppResult<Entry> {
    Ok(Entry::new(SERVICE, ACCOUNT)?)
}

pub fn load() -> AppResult<Option<String>> {
    match entry()?.get_password() {
        Ok(token) if !token.is_empty() => Ok(Some(token)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => migrate_legacy(),
        Err(e) => Err(e.into()),
    }
}

/// Move a token saved under the old name to the new one (once), so the
/// rename doesn't sign anyone out.
fn migrate_legacy() -> AppResult<Option<String>> {
    let old = Entry::new(LEGACY_SERVICE, ACCOUNT)?;
    match old.get_password() {
        Ok(token) if !token.is_empty() => {
            save(&token)?;
            let _ = old.delete_credential();
            Ok(Some(token))
        }
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn save(token: &str) -> AppResult<()> {
    Ok(entry()?.set_password(token)?)
}

pub fn clear() -> AppResult<()> {
    for service in [SERVICE, LEGACY_SERVICE] {
        match Entry::new(service, ACCOUNT)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

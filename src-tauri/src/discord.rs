//! Discord status ("Listening to … on Sound2K").
//!
//! Talks only to the Discord desktop app on this PC, over its local IPC pipe
//! (`\\.\pipe\discord-ipc-N`). Nothing goes over the internet from here; the
//! Discord app shows the status to your friends. Off by default (Settings).
//!
//! Needs a Discord "application" id (free, from
//! https://discord.com/developers/applications); its name is what Discord
//! shows ("Sound2K"). Leave the id empty to disable the feature entirely.

use serde::Deserialize;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Your Discord application id (a public number, not a secret).
pub const DISCORD_APP_ID: &str = "1569430125328465930";

/// What the UI wants shown. `None` clears the status.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub title: String,
    pub artist: String,
    pub artwork_url: Option<String>,
    pub permalink_url: Option<String>,
    pub position_ms: u64,
    pub duration_ms: u64,
}

static SENDER: OnceLock<Sender<Option<Presence>>> = OnceLock::new();

/// Last thing that happened, shown under the switch in Settings.
static STATUS: Mutex<String> = Mutex::new(String::new());

fn note(msg: String) {
    eprintln!("[discord] {msg}");
    *STATUS.lock().unwrap_or_else(|e| e.into_inner()) = msg;
}

/// Human-readable connection state for Settings.
pub fn status() -> String {
    if DISCORD_APP_ID.is_empty() {
        return "Not set up".into();
    }
    let s = STATUS.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if s.is_empty() {
        "Waiting for a song to play".into()
    } else {
        s
    }
}

/// Show / clear the status. Never blocks; the worker thread does the IPC.
pub fn set(presence: Option<Presence>) {
    if DISCORD_APP_ID.is_empty() {
        return;
    }
    let tx = SENDER.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        let _ = std::thread::Builder::new()
            .name("discord-status".into())
            .spawn(move || worker(rx));
        tx
    });
    let _ = tx.send(presence);
}

/// Discord allows ~5 updates per 20 s, so updates are spaced out.
const MIN_GAP: Duration = Duration::from_secs(4);
/// When Discord isn't running, look for it again this often.
const RETRY: Duration = Duration::from_secs(20);

fn worker(rx: Receiver<Option<Presence>>) {
    let mut wanted: Option<Presence> = None;
    let mut wanted_at = Instant::now(); // when `wanted.position_ms` was true
    let mut sent: Option<Option<Presence>> = None; // what Discord currently shows
    let mut conn: Option<ipc::Conn> = None;
    let mut last_send = Instant::now() - MIN_GAP;
    let mut last_try = Instant::now() - RETRY;

    loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(p) => {
                wanted = p;
                wanted_at = Instant::now();
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        // Take only the newest request.
        while let Ok(p) = rx.try_recv() {
            wanted = p;
            wanted_at = Instant::now();
        }
        if sent.as_ref() == Some(&wanted) || last_send.elapsed() < MIN_GAP {
            continue;
        }
        if conn.is_none() {
            if wanted.is_none() || last_try.elapsed() < RETRY {
                continue;
            }
            last_try = Instant::now();
            conn = ipc::Conn::open(DISCORD_APP_ID);
            sent = None;
            if conn.is_none() {
                note(format!(
                    "Discord not found (is the Discord desktop app running?)"
                ));
                continue;
            }
            note(format!("Connected to Discord"));
        }
        let late = wanted_at.elapsed().as_millis() as u64;
        last_send = Instant::now();
        let Some(c) = conn.as_mut() else { continue };
        let result = match wanted.as_ref() {
            None => {
                let r = c.set_activity(None);
                if r.is_ok() {
                    note("Paused: status cleared".into());
                }
                r
            }
            Some(p) => {
                // Full status first; if Discord rejects it, fall back to
                // simpler versions (and log why, for troubleshooting).
                let mut result = Ok(Err(String::new()));
                for level in 0..3 {
                    result = c.set_activity(Some(activity_json(p, late, level)));
                    match &result {
                        Ok(Ok(())) => {
                            note(format!("Showing on Discord ✓ (level {level})"));
                            break;
                        }
                        Ok(Err(msg)) => note(format!(
                            "Discord rejected the status (level {level}): {msg}"
                        )),
                        Err(_) => break,
                    }
                }
                result
            }
        };
        match result {
            Ok(_) => sent = Some(wanted.clone()),
            Err(e) => {
                note(format!("Lost connection to Discord: {e}"));
                conn = None; // Discord closed; reconnect later.
            }
        }
    }
}

fn clip(s: &str, max: usize) -> String {
    let s: String = s.chars().take(max).collect();
    // Discord rejects 1-character fields.
    if s.chars().count() < 2 {
        format!("{s}  ")
    } else {
        s
    }
}

fn https_on(url: &str, domains: &[&str]) -> bool {
    url::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str().is_some_and(|h| {
                domains
                    .iter()
                    .any(|d| h == *d || h.ends_with(&format!(".{d}")))
            })
    })
}

/// `late_ms`: time since the UI reported `position_ms`.
/// `level`: 0 = full status, 1 = without newer/optional fields,
/// 2 = bare minimum (used only if Discord rejects the richer ones).
fn activity_json(p: &Presence, late_ms: u64, level: u8) -> serde_json::Value {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let start = now_ms.saturating_sub(p.position_ms + late_ms);
    let mut activity = serde_json::json!({
        "type": 2, // "Listening to"
        "status_display_type": 2, // member list shows the song title
        "details": clip(&p.title, 128),
        "state": clip(&p.artist, 128),
        "timestamps": { "start": start, "end": start + p.duration_ms },
        "assets": {
            // An uploaded asset named "logo" in your Discord app is the fallback.
            "large_image": p.artwork_url.as_deref()
                .filter(|u| https_on(u, &["sndcdn.com"]))
                .map(|u| u.replace("-large.", "-t500x500."))
                .unwrap_or_else(|| "logo".into()),
            "large_text": clip(&p.title, 128),
            "small_image": "logo",
            "small_text": "Sound2K",
        },
    });
    if level >= 1 {
        let obj = activity.as_object_mut().expect("object");
        obj.remove("status_display_type");
        activity["assets"] = serde_json::json!({ "large_image": "logo", "large_text": "Sound2K" });
    }
    if level >= 2 {
        let obj = activity.as_object_mut().expect("object");
        obj.remove("type");
        obj.remove("assets");
        obj.remove("timestamps");
    }
    if level >= 1 {
        return activity;
    }
    if let Some(url) = p
        .permalink_url
        .as_deref()
        .filter(|u| https_on(u, &["soundcloud.com"]))
    {
        activity["buttons"] = serde_json::json!([{ "label": "Listen on SoundCloud", "url": url }]);
    }
    activity
}

#[cfg(windows)]
mod ipc {
    use std::fs::{File, OpenOptions};
    use std::io::{self, Read, Write};

    const HANDSHAKE: u32 = 0;
    const FRAME: u32 = 1;
    const CLOSE: u32 = 2;

    pub struct Conn {
        pipe: File,
        nonce: u64,
    }

    impl Conn {
        /// Connect to whichever Discord pipe is open (Discord, PTB, Canary…).
        pub fn open(app_id: &str) -> Option<Conn> {
            (0..10).find_map(|n| {
                let pipe = OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(format!(r"\\.\pipe\discord-ipc-{n}"))
                    .ok()?;
                let mut conn = Conn { pipe, nonce: 0 };
                conn.send(
                    HANDSHAKE,
                    &serde_json::json!({ "v": 1, "client_id": app_id }),
                )
                .ok()?;
                // Discord answers with READY (or closes on a bad app id).
                match conn.read() {
                    Ok((op, _)) if op != CLOSE => Some(conn),
                    Ok((_, reply)) => {
                        super::note(format!(
                            "Discord refused the connection: {}",
                            String::from_utf8_lossy(&reply)
                        ));
                        None
                    }
                    Err(_) => None,
                }
            })
        }

        /// `Err` = the connection broke; `Ok(Err(msg))` = Discord refused
        /// this activity (the connection is still fine).
        pub fn set_activity(
            &mut self,
            activity: Option<serde_json::Value>,
        ) -> io::Result<Result<(), String>> {
            self.nonce += 1;
            let body = serde_json::json!({
                "cmd": "SET_ACTIVITY",
                "args": { "pid": std::process::id(), "activity": activity },
                "nonce": self.nonce.to_string(),
            });
            self.send(FRAME, &body)?;
            let (op, reply) = self.read()?;
            if op == CLOSE {
                return Err(io::Error::new(io::ErrorKind::ConnectionAborted, "closed"));
            }
            let reply: serde_json::Value = serde_json::from_slice(&reply).unwrap_or_default();
            if reply["evt"] == "ERROR" {
                return Ok(Err(reply["data"]["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .to_string()));
            }
            Ok(Ok(()))
        }

        fn send(&mut self, op: u32, body: &serde_json::Value) -> io::Result<()> {
            let data = serde_json::to_vec(body)?;
            let mut frame = Vec::with_capacity(8 + data.len());
            frame.extend_from_slice(&op.to_le_bytes());
            frame.extend_from_slice(&(data.len() as u32).to_le_bytes());
            frame.extend_from_slice(&data);
            self.pipe.write_all(&frame)?;
            self.pipe.flush()
        }

        /// Read one reply frame: (opcode, JSON body).
        fn read(&mut self) -> io::Result<(u32, Vec<u8>)> {
            let mut header = [0u8; 8];
            self.pipe.read_exact(&mut header)?;
            let op = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
            let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
            if len > 64 * 1024 {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too big"));
            }
            let mut body = vec![0u8; len];
            self.pipe.read_exact(&mut body)?;
            Ok((op, body))
        }
    }
}

#[cfg(not(windows))]
mod ipc {
    pub struct Conn;
    impl Conn {
        pub fn open(_app_id: &str) -> Option<Conn> {
            None
        }
        pub fn set_activity(
            &mut self,
            _a: Option<serde_json::Value>,
        ) -> std::io::Result<Result<(), String>> {
            Ok(Ok(()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Presence {
        Presence {
            title: "X".into(),
            artist: "Some Artist".into(),
            artwork_url: Some("https://i1.sndcdn.com/artworks-abc-large.jpg".into()),
            permalink_url: Some("https://soundcloud.com/a/b".into()),
            position_ms: 30_000,
            duration_ms: 200_000,
        }
    }

    #[test]
    fn builds_listening_activity() {
        let a = activity_json(&sample(), 0, 0);
        assert_eq!(a["type"], 2);
        assert_eq!(a["details"], "X  ");
        assert_eq!(
            a["assets"]["large_image"],
            "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"
        );
        assert_eq!(a["buttons"][0]["url"], "https://soundcloud.com/a/b");
        let start = a["timestamps"]["start"].as_u64().unwrap();
        assert_eq!(a["timestamps"]["end"].as_u64().unwrap() - start, 200_000);
    }

    #[test]
    fn rejects_foreign_links() {
        let mut p = sample();
        p.artwork_url = Some("https://evil.example/x.jpg".into());
        p.permalink_url = Some("https://soundcloud.com.evil.net/x".into());
        let a = activity_json(&p, 0, 0);
        assert_eq!(a["assets"]["large_image"], "logo");
        assert!(a.get("buttons").is_none());
    }
}

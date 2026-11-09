//! Audio playback engine.
//!
//! A dedicated thread owns the audio output (rodio); decoding is done by
//! symphonia (`decode.rs`) and every track passes through the processing
//! stage in `dsp.rs` (equalizer, levelling, visualizer tap). The UI polls
//! [`Player::status`]; queue, shuffle and repeat logic live in the UI.
//!
//! Every load gets a new *generation* number, so a slow load that finishes
//! after the user already skipped ahead is discarded. The next track can be
//! *preloaded* so it starts instantly, and tracks can crossfade.

pub mod buffer;
pub mod decode;
pub mod dsp;
pub mod dsp_math;
pub mod stream;

use crate::soundcloud::StreamKind;
use buffer::SharedBuffer;
use dsp::{DspShared, Processed};
use rodio::{OutputStream, Sink, Source};
use serde::Serialize;
use std::f32::consts::FRAC_PI_2;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// Samples the engine plays (16-bit PCM).
pub type BoxedSource = Box<dyn Source<Item = i16> + Send>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayState {
    #[default]
    Idle,
    Loading,
    Playing,
    Paused,
    Ended,
    Error,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStatus {
    pub track_id: Option<String>,
    pub state: PlayState,
    pub position_ms: u64,
    pub error: Option<String>,
    pub generation: u64,
}

/// A track whose stream is already downloading in the background.
pub struct Preloaded {
    pub track_id: String,
    pub kind: StreamKind,
    pub buffer: Arc<SharedBuffer>,
}

enum Cmd {
    Play {
        generation: u64,
        source: BoxedSource,
        fade: Duration,
    },
    Pause,
    Resume,
    Seek(Duration),
    Volume(f32),
    Stop,
}

pub struct Player {
    tx: Sender<Cmd>,
    status: Arc<Mutex<PlayerStatus>>,
    generation: AtomicU64,
    /// Stream of the current track.
    buffer: Mutex<Option<Arc<SharedBuffer>>>,
    /// Stream of the track fading out during a crossfade.
    fading_buffer: Mutex<Option<Arc<SharedBuffer>>>,
    /// The upcoming track, downloading ahead of time.
    next: Mutex<Option<Preloaded>>,
    pub dsp: Arc<DspShared>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Player {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(PlayerStatus::default()));
        let thread_status = Arc::clone(&status);
        std::thread::Builder::new()
            .name("audio".into())
            .spawn(move || audio_thread(rx, thread_status))
            .expect("failed to start the audio thread");
        Self {
            tx,
            status,
            generation: AtomicU64::new(0),
            buffer: Mutex::new(None),
            fading_buffer: Mutex::new(None),
            next: Mutex::new(None),
            dsp: DspShared::new(),
        }
    }

    fn send(&self, cmd: Cmd) {
        // Only fails if the audio thread is gone; status then shows an error.
        let _ = self.tx.send(cmd);
    }

    /// Start loading a new track. Without a fade the old track stops now;
    /// with a fade it keeps playing until the new one starts.
    pub fn begin_load(&self, track_id: &str, fade: Duration) -> u64 {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let old = lock(&self.buffer).take();
        if fade.is_zero() {
            if let Some(old) = old {
                old.cancel();
            }
            if let Some(prev) = lock(&self.fading_buffer).take() {
                prev.cancel();
            }
            self.send(Cmd::Stop);
        } else if let Some(prev) = std::mem::replace(&mut *lock(&self.fading_buffer), old) {
            prev.cancel();
        }
        *lock(&self.status) = PlayerStatus {
            track_id: Some(track_id.to_string()),
            state: PlayState::Loading,
            position_ms: 0,
            error: None,
            generation,
        };
        generation
    }

    pub fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation
    }

    pub fn attach_buffer(&self, generation: u64, buffer: Arc<SharedBuffer>) {
        if self.is_current(generation) {
            if let Some(old) = lock(&self.buffer).replace(buffer) {
                old.cancel();
            }
        } else {
            buffer.cancel();
        }
    }

    /// Take the preloaded stream if it is for this track.
    pub fn take_preloaded(&self, track_id: &str) -> Option<Preloaded> {
        let mut next = lock(&self.next);
        if next.as_ref().is_some_and(|p| p.track_id == track_id) {
            next.take()
        } else {
            None
        }
    }

    pub fn is_preloaded(&self, track_id: &str) -> bool {
        lock(&self.next)
            .as_ref()
            .is_some_and(|p| p.track_id == track_id)
    }

    pub fn set_preloaded(&self, preloaded: Preloaded) {
        if let Some(old) = lock(&self.next).replace(preloaded) {
            old.buffer.cancel();
        }
    }

    pub fn play(&self, generation: u64, source: BoxedSource, fade: Duration) {
        if self.is_current(generation) {
            self.dsp.clear_tap();
            let processed: BoxedSource = Box::new(Processed::new(source, Arc::clone(&self.dsp)));
            self.send(Cmd::Play {
                generation,
                source: processed,
                fade,
            });
        }
    }

    pub fn fail(&self, generation: u64, message: String) {
        let mut status = lock(&self.status);
        if status.generation == generation {
            status.state = PlayState::Error;
            status.error = Some(message);
        }
    }

    pub fn pause(&self) {
        self.send(Cmd::Pause);
    }

    pub fn resume(&self) {
        self.send(Cmd::Resume);
    }

    pub fn seek(&self, position: Duration) {
        self.send(Cmd::Seek(position));
    }

    pub fn set_volume(&self, volume: f32) {
        let v = if volume.is_finite() {
            volume.clamp(0.0, 1.0)
        } else {
            0.8
        };
        self.send(Cmd::Volume(v));
    }

    pub fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        for slot in [&self.buffer, &self.fading_buffer] {
            if let Some(old) = lock(slot).take() {
                old.cancel();
            }
        }
        if let Some(next) = lock(&self.next).take() {
            next.buffer.cancel();
        }
        self.send(Cmd::Stop);
        self.dsp.clear_tap();
        let mut status = lock(&self.status);
        *status = PlayerStatus {
            generation: self.generation.load(Ordering::SeqCst),
            ..PlayerStatus::default()
        };
    }

    pub fn status(&self) -> PlayerStatus {
        lock(&self.status).clone()
    }
}

/// Fraction of a fade completed (0..1).
fn progress(start: Instant, duration: Duration) -> f32 {
    if duration.is_zero() {
        1.0
    } else {
        (start.elapsed().as_secs_f32() / duration.as_secs_f32()).min(1.0)
    }
}

struct FadingOut {
    sink: Sink,
    start: Instant,
    duration: Duration,
}

fn audio_thread(rx: Receiver<Cmd>, status: Arc<Mutex<PlayerStatus>>) {
    // The output stream must stay alive (and on this thread) while playing.
    let (_stream, handle) = match OutputStream::try_default() {
        Ok(pair) => pair,
        Err(e) => {
            let mut s = lock(&status);
            s.state = PlayState::Error;
            s.error = Some(format!("No audio output device is available ({e})."));
            drop(s);
            // Keep draining so senders never block or error noisily.
            while rx.recv().is_ok() {}
            return;
        }
    };

    let mut sink: Option<Sink> = None;
    let mut volume: f32 = 0.8;
    let mut fading_out: Vec<FadingOut> = Vec::new();
    let mut fade_in: Option<(Instant, Duration)> = None;

    loop {
        let tick = if fade_in.is_some() || !fading_out.is_empty() {
            Duration::from_millis(25)
        } else {
            Duration::from_millis(50)
        };
        match rx.recv_timeout(tick) {
            Ok(Cmd::Play {
                generation,
                source,
                fade,
            }) => {
                if let Some(old) = sink.take() {
                    if !fade.is_zero() && !old.empty() && !old.is_paused() {
                        fading_out.push(FadingOut {
                            sink: old,
                            start: Instant::now(),
                            duration: fade,
                        });
                    } else {
                        old.stop();
                    }
                }
                match Sink::try_new(&handle) {
                    Ok(new_sink) => {
                        let crossfading = !fading_out.is_empty() && !fade.is_zero();
                        new_sink.set_volume(if crossfading { 0.0 } else { volume });
                        fade_in = crossfading.then(|| (Instant::now(), fade));
                        new_sink.append(source);
                        new_sink.play();
                        sink = Some(new_sink);
                        let mut s = lock(&status);
                        if s.generation == generation {
                            s.state = PlayState::Playing;
                            s.position_ms = 0;
                        }
                    }
                    Err(e) => {
                        let mut s = lock(&status);
                        s.state = PlayState::Error;
                        s.error = Some(format!("Couldn't open the audio output ({e})."));
                    }
                }
            }
            Ok(Cmd::Pause) => {
                // Pausing mid-crossfade finishes the crossfade immediately.
                for f in fading_out.drain(..) {
                    f.sink.stop();
                }
                if let Some(s) = &sink {
                    if fade_in.take().is_some() {
                        s.set_volume(volume);
                    }
                    s.pause();
                    let mut st = lock(&status);
                    if st.state == PlayState::Playing {
                        st.state = PlayState::Paused;
                    }
                }
            }
            Ok(Cmd::Resume) => {
                if let Some(s) = &sink {
                    s.play();
                    let mut st = lock(&status);
                    if st.state == PlayState::Paused {
                        st.state = PlayState::Playing;
                    }
                }
            }
            Ok(Cmd::Seek(to)) => {
                if let Some(s) = &sink {
                    // May wait briefly if seeking past what has downloaded.
                    let _ = s.try_seek(to);
                }
            }
            Ok(Cmd::Volume(v)) => {
                volume = v;
                if let (Some(s), None) = (&sink, fade_in) {
                    s.set_volume(v);
                }
            }
            Ok(Cmd::Stop) => {
                if let Some(old) = sink.take() {
                    old.stop();
                }
                for f in fading_out.drain(..) {
                    f.sink.stop();
                }
                fade_in = None;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }

        // Equal-power crossfade ramps.
        fading_out.retain(|f| {
            let t = progress(f.start, f.duration);
            if t >= 1.0 || f.sink.empty() {
                f.sink.stop();
                false
            } else {
                f.sink.set_volume(volume * (t * FRAC_PI_2).cos());
                true
            }
        });
        if let (Some((start, duration)), Some(s)) = (fade_in, &sink) {
            let t = progress(start, duration);
            s.set_volume(volume * (t * FRAC_PI_2).sin());
            if t >= 1.0 {
                fade_in = None;
            }
        }

        // Publish position, and detect the end of the track.
        if let Some(s) = &sink {
            let mut st = lock(&status);
            if matches!(st.state, PlayState::Playing | PlayState::Paused) {
                st.position_ms = s.get_pos().as_millis() as u64;
                if s.empty() {
                    st.state = PlayState::Ended;
                }
            }
        }
    }
}

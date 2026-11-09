//! Real-time processing stage between the decoder and the speakers:
//! equalizer → volume levelling → soft limiter, plus a sample tap that
//! feeds the visualizer. Settings can change while a track plays.

use super::dsp_math::{soft_limit, spectrum, Equalizer, Leveller};
use rodio::source::SeekError;
use rodio::Source;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

/// Mono samples kept for the visualizer.
const TAP_LEN: usize = 2048;
/// Samples pushed to the tap at a time (one lock per chunk).
const TAP_CHUNK: usize = 512;
/// How often (in samples) to check for new settings.
const SETTINGS_CHECK_EVERY: usize = 2048;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DspSettings {
    pub eq_enabled: bool,
    pub eq_gains: [f32; 10],
    pub normalize: bool,
}

impl Default for DspSettings {
    fn default() -> Self {
        Self {
            eq_enabled: false,
            eq_gains: [0.0; 10],
            normalize: false,
        }
    }
}

impl DspSettings {
    fn effective_gains(&self) -> [f32; 10] {
        if self.eq_enabled {
            self.eq_gains
        } else {
            [0.0; 10]
        }
    }
}

struct Tap {
    ring: Vec<f32>,
    next: usize,
    filled: usize,
    rate: u32,
}

/// Shared between the engine (settings, spectrum reads) and playing tracks.
pub struct DspShared {
    settings: Mutex<DspSettings>,
    version: AtomicU64,
    tap: Mutex<Tap>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl DspShared {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            settings: Mutex::new(DspSettings::default()),
            version: AtomicU64::new(1),
            tap: Mutex::new(Tap {
                ring: vec![0.0; TAP_LEN],
                next: 0,
                filled: 0,
                rate: 44_100,
            }),
        })
    }

    pub fn set(&self, settings: DspSettings) {
        *lock(&self.settings) = settings;
        self.version.fetch_add(1, Ordering::SeqCst);
    }

    fn snapshot(&self) -> (u64, DspSettings) {
        (self.version.load(Ordering::SeqCst), *lock(&self.settings))
    }

    fn push_tap(&self, samples: &[f32], rate: u32) {
        let mut tap = lock(&self.tap);
        tap.rate = rate;
        for &s in samples {
            let i = tap.next;
            tap.ring[i] = s;
            tap.next = (i + 1) % TAP_LEN;
        }
        tap.filled = (tap.filled + samples.len()).min(TAP_LEN);
    }

    pub fn clear_tap(&self) {
        let mut tap = lock(&self.tap);
        tap.ring.iter_mut().for_each(|s| *s = 0.0);
        tap.filled = 0;
    }

    /// Bar heights (0..1) for the visualizer.
    pub fn spectrum(&self, bars: usize) -> Vec<f32> {
        let bars = bars.clamp(1, 128);
        let (ordered, rate) = {
            let tap = lock(&self.tap);
            if tap.filled < TAP_LEN / 2 {
                return vec![0.0; bars];
            }
            let mut v = Vec::with_capacity(TAP_LEN);
            v.extend_from_slice(&tap.ring[tap.next..]);
            v.extend_from_slice(&tap.ring[..tap.next]);
            (v, tap.rate)
        };
        spectrum(&ordered, rate, bars)
    }
}

/// Wraps a decoded track and applies the processing chain.
pub struct Processed<S> {
    inner: S,
    shared: Arc<DspShared>,
    version: u64,
    settings: DspSettings,
    eq: Equalizer,
    leveller: Leveller,
    channels: usize,
    rate: u32,
    channel: usize,
    since_check: usize,
    mono_sum: f32,
    tap_chunk: Vec<f32>,
}

impl<S: Source<Item = i16>> Processed<S> {
    pub fn new(inner: S, shared: Arc<DspShared>) -> Self {
        let channels = inner.channels().max(1) as usize;
        let rate = inner.sample_rate();
        let (version, settings) = shared.snapshot();
        Self {
            eq: Equalizer::new(&settings.effective_gains(), rate, channels),
            leveller: Leveller::new(rate, channels),
            inner,
            shared,
            version,
            settings,
            channels,
            rate,
            channel: 0,
            since_check: 0,
            mono_sum: 0.0,
            tap_chunk: Vec::with_capacity(TAP_CHUNK),
        }
    }

    fn refresh_settings(&mut self) {
        let (version, settings) = self.shared.snapshot();
        if version == self.version {
            return;
        }
        if settings.effective_gains() != self.settings.effective_gains() {
            self.eq = Equalizer::new(&settings.effective_gains(), self.rate, self.channels);
        }
        if settings.normalize && !self.settings.normalize {
            self.leveller = Leveller::new(self.rate, self.channels);
        }
        self.version = version;
        self.settings = settings;
    }
}

impl<S: Source<Item = i16>> Iterator for Processed<S> {
    type Item = i16;

    fn next(&mut self) -> Option<i16> {
        let raw = self.inner.next()?;

        self.since_check += 1;
        if self.since_check >= SETTINGS_CHECK_EVERY {
            self.since_check = 0;
            self.refresh_settings();
        }

        let ch = self.channel;
        self.channel = (ch + 1) % self.channels;

        let mut y = raw as f32 / 32768.0;
        let shaping = self.settings.eq_enabled || self.settings.normalize;
        if self.settings.eq_enabled {
            y = self.eq.process(ch, y);
        }
        if self.settings.normalize {
            y = self.leveller.process(y);
        }
        if shaping {
            y = soft_limit(y);
        }

        // Visualizer tap (mono mix).
        self.mono_sum += y;
        if self.channel == 0 {
            self.tap_chunk.push(self.mono_sum / self.channels as f32);
            self.mono_sum = 0.0;
            if self.tap_chunk.len() >= TAP_CHUNK {
                self.shared.push_tap(&self.tap_chunk, self.rate);
                self.tap_chunk.clear();
            }
        }

        if shaping {
            Some((y * 32767.0).round().clamp(-32768.0, 32767.0) as i16)
        } else {
            Some(raw)
        }
    }
}

impl<S: Source<Item = i16>> Source for Processed<S> {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(pos)?;
        self.eq.reset();
        self.channel = 0;
        self.mono_sum = 0.0;
        Ok(())
    }
}

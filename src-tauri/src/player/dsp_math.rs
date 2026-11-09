//! Pure signal-processing building blocks (no audio I/O):
//! a 10-band peaking equalizer, automatic volume levelling with a soft
//! limiter, and a small spectrum analyser for the visualizer.

use std::f32::consts::PI;

/// Equalizer band centre frequencies (Hz).
pub const EQ_BANDS: [f32; 10] = [
    31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];
pub const EQ_MAX_DB: f32 = 12.0;
const EQ_Q: f32 = 1.41;

/// Second-order IIR filter (RBJ "peaking EQ" design), transposed direct form II.
#[derive(Debug, Clone, Copy)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl Biquad {
    pub const IDENTITY: Biquad = Biquad {
        b0: 1.0,
        b1: 0.0,
        b2: 0.0,
        a1: 0.0,
        a2: 0.0,
    };

    pub fn peaking(freq: f32, gain_db: f32, q: f32, sample_rate: f32) -> Biquad {
        if gain_db.abs() < 0.01 || freq >= sample_rate * 0.45 {
            return Biquad::IDENTITY;
        }
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sample_rate;
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q);
        let a0 = 1.0 + alpha / a;
        Biquad {
            b0: (1.0 + alpha * a) / a0,
            b1: (-2.0 * cos) / a0,
            b2: (1.0 - alpha * a) / a0,
            a1: (-2.0 * cos) / a0,
            a2: (1.0 - alpha / a) / a0,
        }
    }

    #[inline]
    fn run(&self, x: f32, s: &mut [f32; 2]) -> f32 {
        let y = self.b0 * x + s[0];
        s[0] = self.b1 * x - self.a1 * y + s[1];
        s[1] = self.b2 * x - self.a2 * y;
        y
    }
}

/// 10 peaking filters per channel.
pub struct Equalizer {
    filters: [Biquad; 10],
    /// state[channel][band]
    state: Vec<[[f32; 2]; 10]>,
    active: bool,
}

impl Equalizer {
    pub fn new(gains_db: &[f32; 10], sample_rate: u32, channels: usize) -> Self {
        let mut filters = [Biquad::IDENTITY; 10];
        let mut active = false;
        for (i, f) in filters.iter_mut().enumerate() {
            let g = gains_db[i].clamp(-EQ_MAX_DB, EQ_MAX_DB);
            *f = Biquad::peaking(EQ_BANDS[i], g, EQ_Q, sample_rate as f32);
            active |= g.abs() >= 0.01;
        }
        Self {
            filters,
            state: vec![[[0.0; 2]; 10]; channels.max(1)],
            active,
        }
    }

    #[inline]
    pub fn process(&mut self, channel: usize, x: f32) -> f32 {
        if !self.active {
            return x;
        }
        let Some(state) = self.state.get_mut(channel) else {
            return x;
        };
        let mut y = x;
        for (f, s) in self.filters.iter().zip(state.iter_mut()) {
            y = f.run(y, s);
        }
        y
    }

    pub fn reset(&mut self) {
        for ch in &mut self.state {
            *ch = [[0.0; 2]; 10];
        }
    }
}

/// Gentle automatic gain: measures loudness over 100 ms blocks and slowly
/// steers towards a target level (quiet tracks up, loud tracks down).
pub struct Leveller {
    target_rms: f32,
    gain: f32,
    target_gain: f32,
    block_len: usize,
    block_count: usize,
    block_sum: f32,
    first_block: bool,
    rise: f32,
    fall: f32,
}

impl Leveller {
    pub const MIN_GAIN: f32 = 0.35;
    pub const MAX_GAIN: f32 = 3.0;

    pub fn new(sample_rate: u32, channels: usize) -> Self {
        let per_second = (sample_rate as f32) * channels.max(1) as f32;
        Self {
            target_rms: 0.16,
            gain: 1.0,
            target_gain: 1.0,
            block_len: (per_second / 10.0).max(1.0) as usize,
            block_count: 0,
            block_sum: 0.0,
            first_block: true,
            // Slow to turn up (~2 s), quicker to turn down (~0.4 s).
            rise: 1.0 / (per_second * 2.0),
            fall: 1.0 / (per_second * 0.4),
        }
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        self.block_sum += x * x;
        self.block_count += 1;
        if self.block_count >= self.block_len {
            let rms = (self.block_sum / self.block_count as f32).sqrt();
            // Ignore near-silence so fade-outs aren't pumped up.
            if rms > 0.01 {
                self.target_gain = (self.target_rms / rms).clamp(Self::MIN_GAIN, Self::MAX_GAIN);
                if self.first_block {
                    self.gain = self.target_gain;
                    self.first_block = false;
                }
            }
            self.block_sum = 0.0;
            self.block_count = 0;
        }
        let k = if self.target_gain < self.gain {
            self.fall
        } else {
            self.rise
        };
        self.gain += (self.target_gain - self.gain) * k;
        x * self.gain
    }

    /// Current gain (used by the tests).
    #[cfg(test)]
    pub fn gain(&self) -> f32 {
        self.gain
    }
}

/// Smoothly limits peaks above 0.9 so boosted audio never hard-clips.
#[inline]
pub fn soft_limit(x: f32) -> f32 {
    const KNEE: f32 = 0.9;
    let a = x.abs();
    if a <= KNEE {
        x
    } else {
        let over = (a - KNEE) / (1.0 - KNEE);
        (KNEE + (1.0 - KNEE) * over.tanh()).copysign(x)
    }
}

/// Spectrum bar heights (0..1) for `bars` log-spaced bands between
/// 40 Hz and 16 kHz, from the most recent mono samples.
pub fn spectrum(samples: &[f32], sample_rate: u32, bars: usize) -> Vec<f32> {
    let n = samples.len();
    if n < 64 || sample_rate == 0 || bars == 0 {
        return vec![0.0; bars];
    }
    let fs = sample_rate as f32;
    let (lo, hi) = (40f32, 16_000f32.min(fs * 0.45));
    // Hann window.
    let windowed: Vec<f32> = samples
        .iter()
        .enumerate()
        .map(|(i, &s)| s * (0.5 - 0.5 * (2.0 * PI * i as f32 / (n - 1) as f32).cos()))
        .collect();
    (0..bars)
        .map(|b| {
            let f = lo * (hi / lo).powf(b as f32 / (bars - 1).max(1) as f32);
            let coeff = 2.0 * (2.0 * PI * f / fs).cos();
            let (mut s1, mut s2) = (0.0f32, 0.0f32);
            for &x in &windowed {
                let s0 = x + coeff * s1 - s2;
                s2 = s1;
                s1 = s0;
            }
            let power = (s1 * s1 + s2 * s2 - coeff * s1 * s2).max(0.0);
            // A full-scale sine gives ~n/4 after the Hann window.
            let magnitude = power.sqrt() / (n as f32 / 4.0);
            let db = 20.0 * (magnitude + 1e-9).log10();
            ((db + 60.0) / 60.0).clamp(0.0, 1.0)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, rate: u32, n: usize, amp: f32) -> Vec<f32> {
        (0..n)
            .map(|i| amp * (2.0 * PI * freq * i as f32 / rate as f32).sin())
            .collect()
    }

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }

    #[test]
    fn flat_eq_is_transparent() {
        let mut eq = Equalizer::new(&[0.0; 10], 44_100, 1);
        let input = sine(440.0, 44_100, 4096, 0.5);
        let out: Vec<f32> = input.iter().map(|&x| eq.process(0, x)).collect();
        assert_eq!(input, out);
    }

    #[test]
    fn boosting_a_band_raises_that_frequency_only() {
        let mut gains = [0.0; 10];
        gains[5] = 12.0; // 1 kHz
        let measure = |freq: f32| {
            let mut eq = Equalizer::new(&gains, 44_100, 1);
            let input = sine(freq, 44_100, 44_100, 0.1);
            let out: Vec<f32> = input.iter().map(|&x| eq.process(0, x)).collect();
            rms(&out[22_050..]) / rms(&input[22_050..])
        };
        let at_1k = measure(1000.0);
        let at_60 = measure(60.0);
        assert!((3.5..4.5).contains(&at_1k), "1 kHz gain was {at_1k}");
        assert!((0.95..1.1).contains(&at_60), "60 Hz gain was {at_60}");
    }

    #[test]
    fn eq_is_stable_with_extreme_settings() {
        let mut eq = Equalizer::new(&[12.0; 10], 48_000, 2);
        let mut peak = 0f32;
        for (i, x) in sine(31.0, 48_000, 96_000, 0.9).into_iter().enumerate() {
            peak = peak.max(eq.process(i % 2, x).abs());
        }
        assert!(peak.is_finite() && peak < 20.0);
    }

    #[test]
    fn leveller_raises_quiet_and_lowers_loud_audio() {
        let quiet = sine(440.0, 44_100, 44_100 * 3, 0.03);
        let mut lev = Leveller::new(44_100, 1);
        for &x in &quiet {
            lev.process(x);
        }
        assert!(lev.gain() > 2.0, "quiet gain {}", lev.gain());

        let loud = sine(440.0, 44_100, 44_100 * 3, 0.9);
        let mut lev = Leveller::new(44_100, 1);
        for &x in &loud {
            lev.process(x);
        }
        assert!(lev.gain() < 0.4, "loud gain {}", lev.gain());
    }

    #[test]
    fn leveller_ignores_silence() {
        let mut lev = Leveller::new(44_100, 2);
        for _ in 0..200_000 {
            lev.process(0.0);
        }
        assert_eq!(lev.gain(), 1.0);
    }

    #[test]
    fn soft_limit_never_exceeds_one_and_keeps_small_signals() {
        assert_eq!(soft_limit(0.5), 0.5);
        assert_eq!(soft_limit(-0.5), -0.5);
        for x in [0.95f32, 1.5, 3.0, 100.0] {
            let y = soft_limit(x);
            assert!(y > 0.9 && y <= 1.0, "{x} -> {y}");
            assert_eq!(soft_limit(-x), -y);
        }
    }

    #[test]
    fn spectrum_peaks_at_the_played_frequency() {
        let bars = spectrum(&sine(1000.0, 44_100, 2048, 0.8), 44_100, 32);
        let loudest = bars
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(i, _)| i)
            .unwrap();
        let f = 40.0 * (16_000f32 / 40.0).powf(loudest as f32 / 31.0);
        assert!((700.0..1400.0).contains(&f), "peak bar at {f} Hz");
        assert!(bars[0] < 0.4);
        assert!(spectrum(&[0.0; 2048], 44_100, 32).iter().all(|&v| v == 0.0));
    }
}

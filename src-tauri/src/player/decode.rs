//! Audio decoding with symphonia, exposed to rodio as a `Source`.
//!
//! rodio's built-in decoder performs a seek while initializing and panics
//! if the stream can't seek (as with streamed AAC/MP4). This decoder never
//! seeks on its own; user seeks that the stream can't do are ignored.

use super::buffer::BufferReader;
use rodio::source::SeekError;
use rodio::Source;
use std::time::Duration;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

impl MediaSource for BufferReader {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        // Only known once the whole stream has downloaded.
        self.known_len()
    }
}

pub struct StreamDecoder {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    samples: Vec<i16>,
    pos: usize,
    channels: u16,
    sample_rate: u32,
}

impl StreamDecoder {
    /// Probe the stream and decode the first block of audio.
    /// `extension` is a hint such as "mp3" or "mp4".
    pub fn open(reader: BufferReader, extension: &str) -> Result<Self, String> {
        let stream = MediaSourceStream::new(Box::new(reader), Default::default());
        let mut hint = Hint::new();
        hint.with_extension(extension);
        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                stream,
                &FormatOptions {
                    enable_gapless: true,
                    ..Default::default()
                },
                &MetadataOptions::default(),
            )
            .map_err(|e| format!("unrecognized audio format ({e})"))?;
        let format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or("no audio track in the stream")?;
        let track_id = track.id;
        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| format!("unsupported audio codec ({e})"))?;

        let mut this = Self {
            format,
            decoder,
            track_id,
            samples: Vec::new(),
            pos: 0,
            channels: 2,
            sample_rate: 44_100,
        };
        if !this.refill() {
            return Err("the stream contained no playable audio".into());
        }
        Ok(this)
    }

    /// Decode the next packet into `samples`. Returns false at the end.
    fn refill(&mut self) -> bool {
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                // End of stream, download stopped, or unreadable data.
                Err(_) => return false,
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            match self.decoder.decode(&packet) {
                Ok(audio) => {
                    let spec = *audio.spec();
                    let mut buf = SampleBuffer::<i16>::new(audio.capacity() as u64, spec);
                    buf.copy_interleaved_ref(audio);
                    if buf.samples().is_empty() {
                        continue;
                    }
                    self.samples.clear();
                    self.samples.extend_from_slice(buf.samples());
                    self.pos = 0;
                    self.channels = spec.channels.count().max(1) as u16;
                    self.sample_rate = spec.rate;
                    return true;
                }
                // A corrupt frame: skip it and keep playing.
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(_) => return false,
            }
        }
    }
}

impl Iterator for StreamDecoder {
    type Item = i16;

    fn next(&mut self) -> Option<i16> {
        if self.pos >= self.samples.len() && !self.refill() {
            return None;
        }
        let sample = self.samples.get(self.pos).copied();
        self.pos += 1;
        sample
    }
}

impl Source for StreamDecoder {
    fn current_frame_len(&self) -> Option<usize> {
        // One continuous span. Reporting each decoded packet as its own
        // frame makes rodio reset its resampler every ~23 ms, which sounds
        // like rapid chopping. Channels and rate don't change mid-track.
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        let result = self.format.seek(
            SeekMode::Coarse,
            SeekTo::Time {
                time: Time::from(pos.as_secs_f64()),
                track_id: Some(self.track_id),
            },
        );
        match result {
            Ok(_) => {
                self.decoder.reset();
                self.samples.clear();
                self.pos = 0;
                Ok(())
            }
            Err(_) => Err(SeekError::NotSupported {
                underlying_source: "streamed audio",
            }),
        }
    }
}

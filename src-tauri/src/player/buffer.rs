//! In-memory streaming buffer.
//!
//! A download task appends bytes; the decoder reads them through
//! [`BufferReader`] (Read + Seek), waiting when it gets ahead of the
//! download. Audio is never written to disk, and each track's buffer is
//! dropped when the next track starts.

use std::io::{self, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

/// Refuse to hold more than this per track (~5 hours of 128 kbps MP3).
pub const MAX_BYTES: usize = 300 * 1024 * 1024;

#[derive(Default)]
struct Inner {
    data: Vec<u8>,
    done: bool,
    failed: bool,
}

#[derive(Default)]
pub struct SharedBuffer {
    inner: Mutex<Inner>,
    ready: Condvar,
    cancelled: AtomicBool,
}

impl SharedBuffer {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Append downloaded bytes. Returns false if the buffer is full.
    pub fn push(&self, bytes: &[u8]) -> bool {
        let mut inner = self.lock();
        if inner.data.len() + bytes.len() > MAX_BYTES {
            inner.failed = true;
            self.ready.notify_all();
            return false;
        }
        inner.data.extend_from_slice(bytes);
        self.ready.notify_all();
        true
    }

    pub fn finish(&self) {
        self.lock().done = true;
        self.ready.notify_all();
    }

    pub fn fail(&self) {
        self.lock().failed = true;
        self.ready.notify_all();
    }

    /// Stop the download and make readers see end-of-stream.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.ready.notify_all();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Block until at least `min` bytes are buffered or the download ended.
    /// Returns false if nothing usable arrived (failed or cancelled).
    pub fn wait_for(&self, min: usize) -> bool {
        let mut inner = self.lock();
        loop {
            if self.is_cancelled() {
                return false;
            }
            if inner.data.len() >= min || inner.done {
                return !inner.data.is_empty();
            }
            if inner.failed {
                return false;
            }
            inner = self.ready.wait(inner).unwrap_or_else(|e| e.into_inner());
        }
    }

    /// Block until the whole stream has downloaded. Returns false if the
    /// download failed, was cancelled, or produced no data.
    pub fn wait_until_complete(&self) -> bool {
        let mut inner = self.lock();
        loop {
            if self.is_cancelled() || inner.failed {
                return false;
            }
            if inner.done {
                return !inner.data.is_empty();
            }
            inner = self.ready.wait(inner).unwrap_or_else(|e| e.into_inner());
        }
    }

    /// The first `n` bytes as hex (for diagnosing unknown formats).
    pub fn head_hex(&self, n: usize) -> String {
        let inner = self.lock();
        inner
            .data
            .iter()
            .take(n)
            .map(|b| format!("{b:02x}"))
            .collect::<Vec<_>>()
            .join(" ")
    }

    pub fn reader(self: &Arc<Self>) -> BufferReader {
        BufferReader {
            buffer: Arc::clone(self),
            pos: 0,
        }
    }
}

pub struct BufferReader {
    buffer: Arc<SharedBuffer>,
    pos: usize,
}

impl BufferReader {
    /// Total length, once the download has finished.
    pub fn known_len(&self) -> Option<u64> {
        let inner = self.buffer.lock();
        inner.done.then_some(inner.data.len() as u64)
    }
}

impl Read for BufferReader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        let buf = &self.buffer;
        let mut inner = buf.lock();
        loop {
            if buf.is_cancelled() {
                return Ok(0);
            }
            if self.pos < inner.data.len() {
                let n = out.len().min(inner.data.len() - self.pos);
                out[..n].copy_from_slice(&inner.data[self.pos..self.pos + n]);
                self.pos += n;
                return Ok(n);
            }
            if inner.done || inner.failed {
                return Ok(0);
            }
            inner = buf.ready.wait(inner).unwrap_or_else(|e| e.into_inner());
        }
    }
}

impl Seek for BufferReader {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        let target: i128 = match from {
            SeekFrom::Start(n) => n as i128,
            SeekFrom::Current(d) => self.pos as i128 + d as i128,
            SeekFrom::End(d) => {
                // The end is only known once the download has finished.
                let buf = &self.buffer;
                let mut inner = buf.lock();
                while !(inner.done || inner.failed || buf.is_cancelled()) {
                    inner = buf.ready.wait(inner).unwrap_or_else(|e| e.into_inner());
                }
                inner.data.len() as i128 + d as i128
            }
        };
        if target < 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "seek before start",
            ));
        }
        self.pos = target as usize;
        Ok(self.pos as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn reader_waits_for_data_then_reaches_end() {
        let buf = SharedBuffer::new();
        let mut reader = buf.reader();
        let writer = Arc::clone(&buf);
        let t = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            writer.push(b"hello ");
            thread::sleep(Duration::from_millis(30));
            writer.push(b"world");
            writer.finish();
        });
        let mut out = Vec::new();
        reader.read_to_end(&mut out).unwrap();
        t.join().unwrap();
        assert_eq!(out, b"hello world");
    }

    #[test]
    fn seeking_and_end() {
        let buf = SharedBuffer::new();
        buf.push(b"0123456789");
        buf.finish();
        let mut r = buf.reader();
        assert_eq!(r.seek(SeekFrom::End(-3)).unwrap(), 7);
        let mut s = String::new();
        r.read_to_string(&mut s).unwrap();
        assert_eq!(s, "789");
        r.seek(SeekFrom::Start(2)).unwrap();
        r.seek(SeekFrom::Current(1)).unwrap();
        let mut one = [0u8; 1];
        r.read_exact(&mut one).unwrap();
        assert_eq!(&one, b"3");
        assert!(r.seek(SeekFrom::Current(-100)).is_err());
    }

    #[test]
    fn cancel_unblocks_reader_and_waiters() {
        let buf = SharedBuffer::new();
        let mut r = buf.reader();
        let canceller = Arc::clone(&buf);
        let t = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            canceller.cancel();
        });
        let mut b = [0u8; 4];
        assert_eq!(r.read(&mut b).unwrap(), 0);
        assert!(!buf.wait_for(10));
        t.join().unwrap();
    }

    #[test]
    fn wait_until_complete_and_head() {
        let buf = SharedBuffer::new();
        let writer = Arc::clone(&buf);
        let t = thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            writer.push(&[0x00, 0x00, 0x00, 0x1c, 0x66, 0x74]);
            thread::sleep(Duration::from_millis(20));
            writer.finish();
        });
        assert!(buf.wait_until_complete());
        t.join().unwrap();
        assert_eq!(buf.head_hex(4), "00 00 00 1c");
        assert_eq!(buf.reader().known_len(), Some(6));
        let failed = SharedBuffer::new();
        failed.push(b"x");
        failed.fail();
        assert!(!failed.wait_until_complete());
    }

    #[test]
    fn wait_for_threshold_and_failure() {
        let buf = SharedBuffer::new();
        buf.push(&[1; 10]);
        buf.finish();
        assert!(buf.wait_for(1_000)); // finished early: short track is fine
        let failed = SharedBuffer::new();
        failed.fail();
        assert!(!failed.wait_for(1));
    }
}

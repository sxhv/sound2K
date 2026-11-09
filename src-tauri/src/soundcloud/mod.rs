//! SoundCloud access through the web app's internal API (api-v2).
//!
//! This is NOT the official developer API: it is the same read-only
//! endpoints soundcloud.com uses. It can change without notice. Requests
//! go only to `api-v2.soundcloud.com` (plus the soundcloud.com homepage and
//! scripts, to find the public client id). Everything is read-only except
//! liking/unliking a track when you click the heart.

mod api_types;
mod client;
pub mod time;

pub use api_types::StreamKind;
pub use client::SoundCloud;

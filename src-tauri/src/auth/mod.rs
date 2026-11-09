//! Signing in to SoundCloud and keeping the session token safe.
//!
//! - `login`: opens an in-app SoundCloud sign-in window and reads the session
//!   cookie from *that window only* (never from any installed browser).
//! - `token_store`: keeps the token in Windows Credential Manager.

pub mod login;
pub mod token_store;

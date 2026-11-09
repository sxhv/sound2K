//! Error type shared by all commands.
//!
//! Errors reach the UI as `{ kind, message }`. Messages never include
//! tokens, credentials, or request URLs.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Tauri(tauri::Error),
    NotFound(String),
    /// Could not reach SoundCloud.
    Network(String),
    /// The SoundCloud session is missing or no longer valid.
    Auth(String),
    /// SoundCloud answered with something unexpected.
    Api(String),
    /// Windows Credential Manager failed.
    Credential(String),
    /// The user closed the sign-in window.
    Cancelled,
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::Io(_) => "io",
            AppError::Json(_) => "data",
            AppError::Tauri(_) => "app",
            AppError::NotFound(_) => "not-found",
            AppError::Network(_) => "network",
            AppError::Auth(_) => "auth",
            AppError::Api(_) => "api",
            AppError::Credential(_) => "credential",
            AppError::Cancelled => "cancelled",
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Io(e) => write!(f, "file error: {e}"),
            AppError::Json(e) => write!(f, "data format error: {e}"),
            AppError::Tauri(e) => write!(f, "app error: {e}"),
            AppError::NotFound(what) => write!(f, "not found: {what}"),
            AppError::Network(msg) => write!(f, "couldn't reach SoundCloud ({msg})"),
            AppError::Auth(msg) => write!(f, "{msg}"),
            AppError::Api(msg) => write!(f, "{msg}"),
            AppError::Credential(msg) => write!(f, "Credential Manager error: {msg}"),
            AppError::Cancelled => write!(f, "sign-in was cancelled"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Json(e)
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Tauri(e)
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        // without_url(): request URLs never end up in messages or logs.
        AppError::Network(e.without_url().to_string())
    }
}

impl From<url::ParseError> for AppError {
    fn from(e: url::ParseError) -> Self {
        AppError::Api(format!("invalid address: {e}"))
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Credential(e.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

//! Stand-ins for protected tracks. Some uploads are only offered as
//! DRM-protected streams, which Sound2K doesn't play; often the same song is
//! also on SoundCloud as an unprotected upload (same artist, same title,
//! same length). This finds such a version, if there is one. Strict
//! matching, so a cover, remix or different version is never swapped in.

use crate::library::models::Track;

/// Lengths must match within this many milliseconds.
const LENGTH_TOLERANCE_MS: u64 = 3000;

/// Lowercase letters and digits only (any script), single spaces.
fn normalise(s: &str) -> String {
    let mut out = String::new();
    for word in s
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
    {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&word.to_lowercase());
    }
    out
}

/// The best playable stand-in for `original` among `candidates`.
pub fn pick(original: &Track, candidates: Vec<Track>) -> Option<Track> {
    let title = normalise(&original.title);
    let artist = normalise(&original.artist);
    if title.is_empty() {
        return None;
    }
    candidates
        .into_iter()
        .filter(|c| c.id != original.id && c.playable && !c.protected)
        .filter(|c| normalise(&c.title) == title)
        .filter(|c| {
            normalise(&c.artist) == artist
                || (original.artist_id.is_some() && c.artist_id == original.artist_id)
        })
        .filter(|c| c.duration_ms.abs_diff(original.duration_ms) <= LENGTH_TOLERANCE_MS)
        .max_by_key(|c| c.plays.unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(id: &str, title: &str, artist: &str, ms: u64, playable: bool, plays: u64) -> Track {
        Track {
            id: id.into(),
            title: title.into(),
            artist: artist.into(),
            duration_ms: ms,
            artwork_url: None,
            permalink_url: None,
            liked_at_ms: None,
            playable,
            downloadable: false,
            artist_id: None,
            plays: Some(plays),
            unavailable: None,
            protected: false,
        }
    }

    #[test]
    fn picks_same_song_same_artist_same_length() {
        let original = t(
            "sc:1",
            "Just Give Me One More Day",
            "Alej",
            131_000,
            false,
            41_000,
        );
        let candidates = vec![
            t(
                "sc:1",
                "Just Give Me One More Day",
                "Alej",
                131_000,
                false,
                41_000,
            ),
            t(
                "sc:2",
                "Just Give Me One More Day",
                "Alej",
                131_500,
                true,
                1_400_000,
            ),
            t(
                "sc:3",
                "Just Give Me One More Day (Slowed)",
                "Alej",
                175_000,
                true,
                32_000,
            ),
            t(
                "sc:4",
                "just give me one more day!",
                "Someone Else",
                131_000,
                true,
                9_000_000,
            ),
            t(
                "sc:5",
                "Just Give Me One More Day",
                "Alej",
                160_000,
                true,
                5_000_000,
            ),
        ];
        assert_eq!(
            pick(&original, candidates).map(|c| c.id),
            Some("sc:2".into())
        );
    }

    #[test]
    fn no_match_means_none() {
        let original = t(
            "sc:1",
            "Kaine / Salvation",
            "SQUARE ENIX MUSIC",
            250_000,
            false,
            1,
        );
        let candidates = vec![t(
            "sc:9",
            "Kaine Salvation (Cover)",
            "fan",
            250_000,
            true,
            10,
        )];
        assert!(pick(&original, candidates).is_none());
    }
}

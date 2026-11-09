//! Deterministic sample library used until SoundCloud sign-in (Phase 4).
//!
//! All titles and artist names are invented. 2,000 liked tracks exercise
//! the virtualized list; every 37th track is marked unavailable so the
//! "skip unavailable" behaviour can be tested; one playlist is empty.

use super::models::{PlaylistSummary, Track};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

const LIKED_COUNT: usize = 2_000;
/// Spacing between sample "liked at" times (~17 hours).
const LIKE_SPACING_MS: i64 = 61_000_000;

const ADJECTIVES: &[&str] = &[
    "Neon", "Velvet", "Golden", "Midnight", "Crystal", "Electric", "Hazy", "Paper", "Silver",
    "Sunset", "Lucid", "Amber", "Hollow", "Cosmic", "Faded", "Liquid", "Quiet", "Wild", "Glass",
    "Orange",
];
const NOUNS: &[&str] = &[
    "Afterglow",
    "Signals",
    "Daydream",
    "Horizon",
    "Echoes",
    "Satellite",
    "Tides",
    "Motel",
    "Arcade",
    "Bloom",
    "Skyline",
    "Riverside",
    "Frequencies",
    "Lanterns",
    "Overdrive",
    "Postcards",
    "Weather",
    "Orchard",
    "Voltage",
    "Holiday",
];
const SUFFIXES: &[&str] = &[
    "",
    "",
    "",
    "",
    " (Remix)",
    " (Live)",
    " (Edit)",
    " (Demo)",
    " VIP",
    " (Slowed)",
];
const ARTISTS: &[&str] = &[
    "Kiro Lanes",
    "Mellow Arcade",
    "Tessa Vale",
    "Night Bus Club",
    "Orbit Kid",
    "Juniper Sound",
    "Lo Coast",
    "Paper Moons",
    "Rune & Ray",
    "Static Bloom",
    "Ivy Noor",
    "The Glass Pines",
    "Delta Hours",
    "Soft Engine",
    "Mira Quell",
    "Coastline FM",
    "Haze Theory",
    "Juno Park",
    "Velour Avenue",
    "Pixel Harbor",
    "Amaya Sol",
    "Tangerine Drive",
    "Hollow Hills",
    "Nova Fenn",
    "Quiet Arcade",
    "Sable & Sun",
    "Elio Marsh",
    "Chrome Petals",
    "Little Comet",
    "Ruby Static",
    "Aster Lane",
    "Mono Bay",
];

/// (title, number of tracks, stride). Strides are coprime with 2,000 so the
/// picked tracks never repeat within a playlist.
const PLAYLISTS: &[(&str, usize, usize)] = &[
    ("Late Night Drive", 48, 7),
    ("Focus Loops", 120, 11),
    ("Sunday Morning", 22, 13),
    ("Gym Overdrive", 64, 17),
    ("Rainy Window", 35, 19),
    ("Throwbacks", 210, 21),
    ("Road Trip", 90, 23),
    ("Ideas (empty)", 0, 7),
];

pub struct MockLibrary {
    pub liked: Vec<Track>,
    playlists: Vec<(PlaylistSummary, Vec<usize>)>,
}

impl MockLibrary {
    pub fn playlist_summaries(&self) -> Vec<PlaylistSummary> {
        self.playlists.iter().map(|(p, _)| p.clone()).collect()
    }

    pub fn playlist_tracks(&self, id: &str) -> Option<Vec<Track>> {
        self.playlists
            .iter()
            .find(|(p, _)| p.id == id)
            .map(|(_, idx)| idx.iter().map(|&i| self.liked[i].clone()).collect())
    }
}

pub fn library() -> &'static MockLibrary {
    static LIBRARY: OnceLock<MockLibrary> = OnceLock::new();
    LIBRARY.get_or_init(build)
}

/// Small deterministic generator (PCG-style LCG); no dependency needed.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn pick<'a>(&mut self, items: &[&'a str]) -> &'a str {
        items[self.below(items.len())]
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn build() -> MockLibrary {
    let mut rng = Rng(0x5EED_CAFE);
    let now = now_ms();

    let liked: Vec<Track> = (0..LIKED_COUNT)
        .map(|i| {
            let title = format!(
                "{} {}{}",
                rng.pick(ADJECTIVES),
                rng.pick(NOUNS),
                rng.pick(SUFFIXES)
            );
            let artist = rng.pick(ARTISTS).to_string();
            // Mostly 2–6 minute tracks, plus some short clips and long mixes.
            let duration_ms = match rng.below(20) {
                0 => 45_000 + rng.below(75_000) as u64,
                1 => 900_000 + rng.below(2_700_000) as u64,
                _ => 120_000 + rng.below(240_000) as u64,
            };
            Track {
                id: format!("mock:tracks:{}", i + 1),
                title,
                artist,
                duration_ms,
                artwork_url: None,
                permalink_url: None,
                // Newest first, like the API's likes order.
                liked_at_ms: Some(now - i as i64 * LIKE_SPACING_MS),
                playable: i % 37 != 5,
                downloadable: i % 9 == 1,
            }
        })
        .collect();

    let playlists = PLAYLISTS
        .iter()
        .enumerate()
        .map(|(n, &(title, size, stride))| {
            let start = rng.below(LIKED_COUNT);
            let indices: Vec<usize> = (0..size)
                .map(|k| (start + k * stride) % LIKED_COUNT)
                .collect();
            let summary = PlaylistSummary {
                id: format!("mock:playlists:{}", n + 1),
                title: title.to_string(),
                owner: "You".to_string(),
                track_count: indices.len() as u32,
                artwork_url: None,
                owner_id: 0,
                sharing: None,
            };
            (summary, indices)
        })
        .collect();

    MockLibrary { liked, playlists }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn library_shape() {
        let lib = library();
        assert_eq!(lib.liked.len(), LIKED_COUNT);
        assert!(lib.liked.iter().any(|t| !t.playable));
        let ids: HashSet<_> = lib.liked.iter().map(|t| &t.id).collect();
        assert_eq!(ids.len(), LIKED_COUNT, "track ids must be unique");
    }

    #[test]
    fn playlists_have_unique_tracks_and_one_is_empty() {
        let lib = library();
        let summaries = lib.playlist_summaries();
        assert!(summaries.iter().any(|p| p.track_count == 0));
        for p in summaries {
            let tracks = lib.playlist_tracks(&p.id).unwrap();
            assert_eq!(tracks.len(), p.track_count as usize);
            let ids: HashSet<_> = tracks.iter().map(|t| &t.id).collect();
            assert_eq!(ids.len(), tracks.len());
        }
        assert!(lib.playlist_tracks("nope").is_none());
    }
}

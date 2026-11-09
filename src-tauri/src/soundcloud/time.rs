//! Minimal ISO-8601 parsing for SoundCloud timestamps
//! ("2024-05-01T12:34:56Z"), without pulling in a date library.

/// Parses `YYYY-MM-DDTHH:MM:SS…` (UTC) into Unix milliseconds.
/// Fractional seconds and a trailing `Z` are ignored.
pub fn parse_iso_ms(s: &str) -> Option<i64> {
    let num = |range: std::ops::Range<usize>| -> Option<i64> { s.get(range)?.parse().ok() };
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, min, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let valid =
        (1..=12).contains(&month) && (1..=31).contains(&day) && hour < 24 && min < 60 && sec < 61;
    if !valid {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some(((days * 24 + hour) * 60 + min) * 60_000 + sec * 1000)
}

/// Days since 1970-01-01 (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::parse_iso_ms;

    #[test]
    fn parses_known_instants() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_ms("2000-02-29T00:00:00Z"), Some(951_782_400_000));
        assert_eq!(
            parse_iso_ms("2024-03-01T12:00:00Z"),
            Some(1_709_294_400_000)
        );
        assert_eq!(
            parse_iso_ms("2026-11-08T20:40:05.123Z"),
            Some(1_794_170_405_000)
        );
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_iso_ms(""), None);
        assert_eq!(parse_iso_ms("yesterday"), None);
        assert_eq!(parse_iso_ms("2024-13-01T00:00:00Z"), None);
    }
}

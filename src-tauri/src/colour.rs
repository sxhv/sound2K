//! "Main colour" of a track's artwork, used to theme the app's accents and
//! visualizer. The artwork is a small JPEG from SoundCloud's image CDN,
//! decoded in memory only (never written to disk).

/// Dominant vivid colour of a JPEG, or None (not a JPEG / grey artwork).
pub fn from_jpeg(bytes: &[u8]) -> Option<[u8; 3]> {
    let mut decoder = jpeg_decoder::Decoder::new(bytes);
    let pixels = decoder.decode().ok()?;
    match decoder.info()?.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => pick(&pixels),
        _ => None,
    }
}

/// Weighted average of RGB pixels, favouring saturated mid-brightness
/// colours. Returns None for (nearly) colourless artwork.
pub fn pick(rgb: &[u8]) -> Option<[u8; 3]> {
    let (mut r, mut g, mut b, mut total) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
    let mut vivid = 0usize;
    let pixels = rgb.len() / 3;
    for px in rgb.chunks_exact(3) {
        let (pr, pg, pb) = (px[0] as f64, px[1] as f64, px[2] as f64);
        let max = pr.max(pg).max(pb);
        let min = pr.min(pg).min(pb);
        let sat = if max == 0.0 { 0.0 } else { (max - min) / max };
        let light = (max + min) / 510.0;
        if sat > 0.25 && light > 0.12 && light < 0.92 {
            vivid += 1;
        }
        let w = sat * sat * (1.0 - (light - 0.55).abs() * 1.4).max(0.0);
        if w <= 0.0 {
            continue;
        }
        r += pr * w;
        g += pg * w;
        b += pb * w;
        total += w;
    }
    // Under ~4% colourful pixels: treat as black-and-white artwork.
    if total <= 0.0 || pixels == 0 || vivid * 25 < pixels {
        return None;
    }
    Some([(r / total) as u8, (g / total) as u8, (b / total) as u8])
}

#[cfg(test)]
mod tests {
    use super::pick;

    #[test]
    fn grey_is_none() {
        let px: Vec<u8> = (0..100).flat_map(|i| [i as u8, i as u8, i as u8]).collect();
        assert_eq!(pick(&px), None);
    }

    #[test]
    fn mostly_blue_is_blue() {
        let mut px = Vec::new();
        for _ in 0..80 {
            px.extend_from_slice(&[30, 60, 220]);
        }
        for _ in 0..20 {
            px.extend_from_slice(&[10, 10, 10]);
        }
        let [r, g, b] = pick(&px).unwrap();
        assert!(b > 200 && r < 50 && g < 80, "{r} {g} {b}");
    }
}

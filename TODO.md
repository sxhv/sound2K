# Sound2K — To-do
*(formerly SoundCloud Mini)*

## Next up (agreed)

### Fixes
- [x] **Mini-player steals focus from games.** Make the pinned mini-player *non-activating* (Windows `WS_EX_NOACTIVATE`): buttons still work, but clicking it doesn't pull you out of the game. Plus an optional **click-through lock** (the mini-player ignores the mouse entirely until unlocked from the tray/hotkey). Needs testing with borderless vs exclusive-fullscreen games.
- [x] **Sign-in window safety:** only allow SoundCloud and the Google / Apple / Facebook sign-in pages; show the current domain in the title (it has no address bar).

### Rebrand → Sound2K
- [x] Rename app, window title, README (installer: when built) ("Sound2K — all sounds. one place.")
- [x] Logo in the title bar (wordmark recoloured to orange glass) and new app icon from the logo
- [x] Move data folder `%LOCALAPPDATA%\SoundCloudMini` → `%LOCALAPPDATA%\Sound2K` automatically on first run (and the Credential Manager entry), so nobody has to sign in again

### Apple Music-style polish (all approved)
- [x] Full-screen **Now Playing** view (slides up from the dock artwork)
- [x] **Colours from the artwork**: app + mini-player background and glow tinted by the cover, cross-fading between tracks
- [x] Apple-style **playlist headers** (big cover, blurred backdrop, sticky Play/Shuffle)
- [x] **Queue as a slide-out panel** from the right
- [x] Breathing artwork, artwork cross-fade, play/pause morph, page/row transitions, springy buttons, scrolling long titles
- [x] Respect Windows "reduce motion"; pause animations when minimized

### Storage
- [x] Cap the artwork image cache, add **Settings → Storage**: shows space used + "Clear cache" button

### Before sharing / installer
- [ ] **First-run notice:** unofficial app, uses SoundCloud's internal API, what's cached locally, what *Sign out* removes
- [ ] **Dependency audit:** `cargo audit` (in `src-tauri`) and `npm.cmd audit`
- [ ] **Phase 7: release build + installer:** per-user NSIS installer (no admin), devtools off, test on a clean Windows account, publish SHA-256 checksum

## Big idea: universal player (SoundCloud + Spotify) — to decide
Only possible the official way: the Spotify desktop app plays Spotify tracks, Sound2K controls it and mixes them into its own playlists. Requires Spotify Premium; max 5 users per Spotify developer app; Sound2K's EQ / crossfade / visualizer can't apply to Spotify audio. Spotify audio is DRM-protected and will **not** be decrypted.

## Known rough edges
- [ ] Long DJ mixes (AAC) must download fully before playing → streaming path or a "loading 45 %" indicator
- [ ] Seeking while a track is still loading is ignored
- [ ] Playlist tracks aren't cached (re-fetched each time a playlist is opened)
- [ ] Queue reordering is up/down buttons only (no drag-and-drop)
- [ ] Delete leftover `ui/src/player/mockPlayer.ts` (empty)
- [ ] Error messages still show some technical details (tone down for release)

## Ideas (not decided yet)
- Waveform seek bar (SoundCloud-style)
- Sleep timer
- System tray icon / close to tray (also useful for the click-through lock)
- Keyboard shortcut cheat sheet (`?`)
- Global hotkeys (work while gaming, e.g. Ctrl+Alt+→ for next)
- More themes / "racing" theme to match the new logo
- Remember window size and position; start in mini-player

## Done
- Phases 1–6: research, project setup, interface, SoundCloud sign-in, Rust audio engine, glass title bar, mini-player, media keys
- QoL update: resume session, Open on SoundCloud, autoplay, crossfade + preloading, volume levelling, 10-band EQ, visualizer, likes, mini-player volume

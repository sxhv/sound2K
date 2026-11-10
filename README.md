<p align="center">
  <img src="docs/banner.png" alt="Sound2K: a tiny, glossy SoundCloud player for Windows" width="100%">
</p>

<p align="center">
  <b>Your SoundCloud likes and playlists in a small, fast, Y2K-glass desktop player.</b><br>
  Colours that follow every song, a mini-player that stays out of your games, and a cat that dances along.
</p>

> [!NOTE]
> **Made with AI.** Sound2K was built with the help of AI (Claude by Anthropic): the code was written by AI from my ideas, testing and feedback. I don't consider myself a developer or a programmer, and I don't consider "vibe coding" real development. Please keep that in mind before using the app or the code.

<p align="center">
  <img alt="Windows 10/11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-backend-CE422B">
  <img alt="No telemetry" src="https://img.shields.io/badge/telemetry-none-2ea043">
</p>

<p align="center">
  <img src="docs/home.webp" alt="Sound2K Home page" width="90%">
</p>

---

## Features

**🎧 Listening**
- Four simple tabs (**Home**, **Search**, **Liked Songs**, **Playlists**), with instant search, sorting and filters, even with thousands of tracks
- **Up next** queue in a slide-out panel; **Recently played** on Home
- **Crossfade** (up to 12 s), **volume levelling**, and a **10-band equalizer** with presets
- **Autoplay** keeps the music going with similar tracks when your queue ends
- Picks up where you left off: queue and position are restored on launch

**✨ Look & feel**
- **Song colours:** buttons, sliders, glows and the visualizer take on the colour of the current cover, and fade into the next one
- **Now Playing** full-window view with big artwork on a blurred backdrop
- Apple Music-style touches: playlist headers, slide-out queue, springy buttons, scrolling titles
- **Glass** and **Dark** themes, plus a live **visualizer**
- **Beat glow:** the window edges pulse in the song's colour on every drum hit (turn it off in Settings)
- **The cat** 🐱: dances to the bass, naps when you pause, throws hearts when you like a song

**🎮 Made for gaming**
- **Mini-player** that pins on top and **never steals focus** from your game
- **Ctrl+Alt+L** locks it so clicks pass straight through to the game
- Windows **media keys** and the volume-flyout controls work

**🔎 All of SoundCloud**
- **Search** every track, artist and playlist on SoundCloud
- **Home:** a start page with a *Continue listening* banner (with Up next), *Jump back in*, *Quick picks*, *Mixes for you* (stations built from your most-liked artists), new tracks from artists you follow, *Because you played…*, *Artists you follow*, *Recently liked* and your playlists. Cards resize to fill wide windows
- **Artist pages** with popular tracks, uploads, reposts and playlists, plus **Follow**

**🛠 Your library**
- **Like / unlike**, **create, rename and delete playlists**, add songs with a cover picker, and **drag to reorder**
- **Jump to the playing song** in any list (Ctrl+J)
- **Discord status:** "Listening to …" with cover art and a *Listen on SoundCloud* button (opt-in)
- **Download** tracks whose artist allows it, via SoundCloud's official download
- **Updates itself:** Settings → About → *Update & restart* (signed updates from GitHub Releases)

## Screenshots

| Home: quick picks & mixes | Liked Songs |
|---|---|
| <img src="docs/home-2.webp" alt="Home page with Quick picks and Mixes for you"> | <img src="docs/library.webp" alt="Liked Songs list"> |
| **Search** | **Artist pages** |
| <img src="docs/search.webp" alt="Search results"> | <img src="docs/artist.webp" alt="Artist page with Follow"> |
| **Now Playing** | **Add to playlist** |
| <img src="docs/now-playing.webp" alt="Now Playing view"> | <img src="docs/picker.webp" alt="Add to playlist picker"> |
| **Playlists** | **Playlist** |
| <img src="docs/playlists.webp" alt="Playlists grid"> | <img src="docs/playlist.webp" alt="Playlist with header"> |
| **Equalizer** | **Crossfade & levelling** |
| <img src="docs/equalizer.webp" alt="Equalizer page"> | <img src="docs/sound.webp" alt="Sound page"> |
| **Queue slide-out** | **Dark theme** |
| <img src="docs/queue.webp" alt="Queue panel"> | <img src="docs/dark.webp" alt="Dark theme"> |

<p align="center">
  <b>Mini-player</b><br>
  <img src="docs/mini.webp" alt="Mini-player" width="460">
</p>

<sub>Screenshots use made-up sample tracks and generated cover art; signed in, you'll see your own library and real covers.</sub>

## Install

1. Go to **[Releases](../../releases/latest)** and download `Sound2K_x.y.z_x64-setup.exe`.
2. Run it. It installs **for your user only**: no admin rights, no startup entries.
3. Windows SmartScreen may say *"Windows protected your PC"* because the installer isn't code-signed. Click **More info → Run anyway**.

Requires Windows 10 or 11 with the WebView2 runtime (already included in Windows 11 and up-to-date Windows 10).

## Getting started

Open **Settings** (gear icon) → **Sign in to SoundCloud**. A separate window opens SoundCloud's own sign-in page; it closes by itself once you're in.

| Shortcut | Does |
|---|---|
| **Space** | Play / pause |
| **Ctrl + → / ←** | Next / previous |
| **Ctrl + F** | Search |
| **Ctrl + J** | Jump to the playing song |
| **Esc** | Close Now Playing / the queue |
| **Ctrl + Alt + L** | Lock / unlock the mini-player (click-through) |
| **Double-click** a track | Play it |

## Privacy & security

- **No telemetry, no analytics, no accounts other than SoundCloud.**
- Your sign-in is stored in **Windows Credential Manager**, never in a file. Sound2K never reads your browsers or their saved logins.
- Songs stream **into memory only** and are never saved to disk. App data (settings, cache, history) lives in `%LOCALAPPDATA%\Sound2K`, and the artwork cache is capped at 50 MB.
- The app only talks to SoundCloud, GitHub (to check for updates; can be turned off) and, if you turn it on, the **Discord app on your PC**. Requests to anything else are refused in code.
- **Updates are signed.** Sound2K only installs an update whose signature matches the Sound2K key, so a tampered download can't be installed.
- The window runs under a strict Content Security Policy with minimal Tauri permissions; the sign-in window gets none.

## Build from source

You'll need **Rust** (stable), **Node.js** 20.19+ / 22.12+, and the **Microsoft C++ Build Tools** ("Desktop development with C++").

```powershell
npm install
npm run tauri dev      # run in development
npm run tauri build    # build the installer
```

The installer appears in `src-tauri\target\release\bundle\nsis\`. Rust unit tests: `cd src-tauri; cargo test`.

<details>
<summary><b>Releasing an update</b></summary>

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, then commit and push.
2. On GitHub: **Actions → Release → Run workflow**. (Pushing a tag like `v0.2.0` also works.)
3. It builds and **signs** the installer (~15 min) and creates a **draft** release named after the version. Check it under *Releases* and press **Publish**. Installed copies then offer *Update & restart*.

Signing needs two repository secrets (*Settings → Secrets and variables → Actions*): `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep the private key safe: if it's lost, existing installs can't be updated; if it leaks, someone could sign fake updates.

</details>

<details>
<summary><b>Project layout</b></summary>

```
ui/                 frontend: plain TypeScript + CSS, no framework (Vite)
  src/components/   dock, mini-player, Now Playing, mascot, visualizer, …
  src/views/        liked, playlists, queue, recent, equalizer, sound
src-tauri/          Rust backend (Tauri 2)
  src/player/       streaming, decoding (symphonia), DSP, playback (rodio)
  src/soundcloud/   SoundCloud client
  src/auth/         sign-in window + Credential Manager
  src/discord.rs    Discord status over local IPC
docs/               README images
```

</details>

## Disclaimer

Sound2K is an independent, unofficial project. It is **not affiliated with or endorsed by SoundCloud** or Discord. SoundCloud only offers its official API to Artist Pro subscribers, so Sound2K uses the same internal API as soundcloud.com. It may break when SoundCloud changes things, and it's intended for personal use. It never plays encrypted (Go+) streams and only downloads tracks their artists made downloadable.

<p align="center">
  <img src="docs/cat.png" alt="" width="90"><br>
  <sub>made with ♪ and a cat</sub>
</p>

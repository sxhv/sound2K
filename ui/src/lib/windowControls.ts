// Window actions for the custom title bar and the mini-player.
// Permissions: only start-dragging / minimize / maximize / close (see
// src-tauri/capabilities/default.json); resizing for the mini-player is
// done by the Rust command `set_window_mode`.
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const windowControls = {
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
  setMode: (mini: boolean, pinned: boolean) => invoke<void>("set_window_mode", { mini, pinned }),
};

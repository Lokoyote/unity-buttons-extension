# Unity Buttons & Title for GNOME Shell

![License: GPL-2.0-or-later](https://img.shields.io/badge/License-GPL--2.0--or--later-blue.svg)
![GNOME Shell: 45+ ](https://img.shields.io/badge/GNOME-45%20%7C%2046%20%7C%2047-green.svg)

> Transform your GNOME Shell experience with an Ubuntu Unity-inspired workflow.

---

### 📸 Screenshot
[![Unity Buttons Preview](https://github.com/Lokoyote/unity-buttons-extension/blob/main/Unity-Buttons-Title-screen.png)](Screenshot)
---

# Unity Buttons — GNOME Shell Extension

macOS-style **close** and **restore** buttons in the top panel with the window title displayed alongside, visible when a window is maximized. Unmaximized windows are automatically centered and resized to a configurable percentage of your screen.

![GNOME Shell 46 & 47](https://img.shields.io/badge/GNOME_Shell-46_|_47-4a86cf)
![License](https://img.shields.io/badge/License-GPL--3.0--or--later-blue)
![X11 & Wayland](https://img.shields.io/badge/Session-X11_|_Wayland-green)

## Features

### Panel Buttons & Title
- **Close** and **Restore** buttons appear in the top-left corner of the panel when a window is maximized
- The **window title** is displayed next to the buttons
- Ubuntu-inspired button colors with hover feedback
- Buttons and title automatically hide when no maximized window is focused

### Titlebar Hiding
- When a window is maximized, the WM titlebar decorations are hidden to reclaim vertical space
- On X11: uses `_MOTIF_WM_HINTS` via `xprop` to control decorations (handles both CSD and SSD apps correctly)
- On Wayland: uses `button-layout` manipulation with a CSD nudge workaround
- LibreOffice headerbar is specifically targeted via GTK3 CSS injection (clean, non-destructive)

### Smart Window Centering
- On unmaximize, windows are centered on screen at a configurable size percentage
- On first open, new windows are resized to a minimum percentage of the work area and centered
- Both settings are independently configurable via GSettings

### Native Animations
- All maximize/unmaximize transitions use **100% GNOME Shell native animations** (250ms, EASE_OUT_QUAD)
- The extension never manipulates actor opacity or visibility during transitions — zero visual glitches
- A "saved_rect poisoning" technique overwrites Mutter's internal restore position so that GNOME always animates to the correct centered target

### Robust Architecture
- Full **X11 and Wayland** support, including XWayland windows under Wayland sessions
- Per-window state tracking via WeakMap (automatic garbage collection)
- All deferred timeouts are tracked and cleaned up on `disable()` — no leaked timers
- Safety timeouts prevent windows from getting stuck in broken states
- VLC is excluded from decoration manipulation (known compatibility issue)
- Original `button-layout` is cached to disk and restored cleanly on disable

## Configuration

The extension exposes the following GSettings keys:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `window-size-percent` | int | 80 | Size of centered windows as % of work area |
| `min-open-size-percent` | int | 0 | Minimum size for new windows (0 = disabled) |
| `original-layout-cache` | string | — | Backup of original button-layout (internal) |

## How It Works

### Maximize Flow
1. GNOME Shell animates the window to fullscreen natively (250ms)
2. After the animation completes, the extension hides WM decorations and updates the panel

### Unmaximize Flow (Native)
When `saved_rect` already matches `targetRect`:
1. GNOME Shell animates the window to the centered position natively
2. The extension restores decorations and updates the panel after the animation

### Unmaximize Flow (Override)
When `saved_rect` differs from `targetRect` (first time, or after the user moved the window):
1. The extension intercepts before the first paint frame (PRIORITY_HIGH idle)
2. Kills GNOME's animation, places the window at `targetRect` synchronously
3. Runs a deferred "poison" cycle: invisible `maximize→suppress→unmaximize→suppress` that overwrites Mutter's `saved_rect` with `targetRect`
4. All subsequent cycles become native — GNOME animates directly to the correct position

### CSD vs SSD Detection
- **CSD** (Client-Side Decorations): GTK3/4, libadwaita apps — detected by `buffer_rect > frame_rect`
- **SSD** (Server-Side Decorations): LibreOffice, legacy apps — use explicit `_MOTIF_WM_HINTS` restore
- Detection is cached per window and corrected post-unmaximize when reliable

## Installation

### From extensions.gnome.org
Search for "Unity Buttons" on [extensions.gnome.org](https://extensions.gnome.org/) and click Install.

### Manual
```bash
git clone https://github.com/YOUR_USERNAME/unity-buttons.git
cd unity-buttons
cp -r . ~/.local/share/gnome-shell/extensions/unity-buttons@YOUR_UUID/
```
Then restart GNOME Shell (X11: `Alt+F2` → `r`) or log out/in (Wayland).

## Compatibility

| Environment | Status |
|-------------|--------|
| GNOME Shell 46 | ✅ Tested |
| GNOME Shell 47 | ✅ Tested |
| X11 session | ✅ Full support |
| Wayland session | ✅ Full support |
| XWayland apps | ✅ Handled per-window |
| Multi-monitor | ✅ Per-monitor work area |

### Known Limitations
- **VLC**: excluded from decoration manipulation due to compatibility issues with `_MOTIF_WM_HINTS`
- **LibreOffice**: requires the GTK3 CSS hack for proper headerbar hiding (automatically applied)
- Some apps with strict `WM_NORMAL_HINTS` size constraints may not resize to the exact target percentage

## 📄 License
This project is licensed under the **GNU General Public License v3.0 or later** - see the [LICENSE](LICENSE) file for details.

---
**Developed with ❤️.**

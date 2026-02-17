# Unity Buttons & Title for GNOME Shell

![License: GPL-2.0-or-later](https://img.shields.io/badge/License-GPL--2.0--or--later-blue.svg)
![GNOME Shell: 45+ ](https://img.shields.io/badge/GNOME-45%20%7C%2046%20%7C%2047-green.svg)

> Transform your GNOME Shell experience with an Ubuntu Unity-inspired workflow.

---

### 📸 Screenshot
[![Unity Buttons Preview](https://github.com/Lokoyote/unity-buttons-extension/blob/main/Unity-Buttons-Title.png)](Screenshot)
---

## 🚀 Overview
This extension cleans up your workspace and maximizes your screen real estate by integrating window controls and the application title directly into the top panel. 

It is designed for users of **Ubuntu 24.04** and **Fedora** looking to recapture the productivity of the classic Unity desktop with modern GNOME Shell performance.

## ✨ Key Features
* **Panel buttons** — Close and restore buttons replace the native title bar buttons when a window is maximized
* **Smart centering** — Unmaximized windows are centered on screen; small windows keep their original size
* **Jank-free animation** — Clone-based masking hides Mutter's repositioning artifacts
* **Live title tracking** — Title updates in real time when navigating folders in Nautilus, switching browser tabs, etc.
* **XWayland support** — Works with Spotify, Electron apps, and other XWayland clients
* **Minimum open size** — Optionally enforce a minimum size for new maximizable windows
* **LibreOffice fix** — Hides the redundant headerbar in maximized LibreOffice windows
* **Crash-safe layout** — The original button-layout is backed up to both GSettings and a cache file; restored on disable even after crashes
• **Minmimal window size**: New windows can be resized automatically
* **Smooth animation** during unmaximizing

## 🛠️ Installation

### From extensions.gnome.org

1. Visit Unity Buttons on EGO
2. Toggle the switch to install

### Manual Installation
1. Download the latest release.
2. Extract the folder into `~/.local/share/gnome-shell/extensions/`.
3. Ensure the folder name matches the UUID in `metadata.json`.
4. Log out and log back in (or restart GNOME Shell).
5. Enable the extension using **GNOME Extensions** or **Extension Manager**.

6. ## Settings

Open the preferences with:
```bash
gnome-extensions prefs unity-buttons@music-lmusic.music
```

| Setting | Range | Default | Description |
|---------|-------|---------|-------------|
| **Maximum size** | 50–95% | 80% | Unmaximized windows larger than this are shrunk. The prefs window resizes live as you drag the slider. |
| **Minimum open size** | 30–90% (or off) | Off | New maximizable windows that open smaller than this are enlarged and centered. |

## How it works

When a window is unmaximized for the first time:

1. A `Clutter.Clone` is created at the maximized position
2. The real window is hidden (`opacity = 0`)
3. `unmaximize()` + `move_resize_frame()` reposition the window behind the clone
4. After Mutter settles (~10 ms), the **actual** actor position is read
5. The clone snaps to the actual position (10 ms transition = imperceptible)
6. The real window is revealed → zero visual mismatch

On subsequent maximize/unmaximize cycles, the saved position is reused and Mutter handles the animation natively.

## File structure

```
unity-buttons@music-lmusic.music/
├── extension.js      — Main extension logic
├── prefs.js          — Preferences window (Adw / GTK 4)
├── stylesheet.css    — Panel button styling
├── metadata.json     — Extension metadata
├── schemas/
│   └── org.gnome.shell.extensions.unity-buttons.gschema.xml
├── LICENSE
└── README.md
```

## Development

```bash
# Watch logs
journalctl -f -o cat /usr/bin/gnome-shell

# Enable debug logging (in extension.js, set DEBUG = true)

# Compile schemas after changes
glib-compile-schemas schemas/

# Package for EGO upload
make pack
```

## 📄 License
This project is licensed under the **GNU General Public License v2.0 or later** - see the [LICENSE](LICENSE) file for details.

---
**Developed with ❤️.**

----
### **For Snaps or Flatpaks, window decoration hiding might be limited due to sandbox restrictions. For the best experience, use native (.deb/RPM) packages.**

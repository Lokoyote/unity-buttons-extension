/**
 * Unity Buttons — GNOME Shell Extension
 *
 * macOS-style close/restore buttons in the top panel with smart
 * unmaximize centering, XWayland support, and optional minimum
 * open size enforcement for maximizable windows.
 *
 * GNOME Shell 46 & 47 — License: GPL-3.0-or-later
 */
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';

const DEBUG = false;
const _log = DEBUG
    ? (msg) => console.log(`[Unity] ${msg}`)
    : () => {};

const ANIM_DURATION = 10;

const LO_HACK = `
window.maximized headerbar, window.maximized titlebar, window.maximized .titlebar {
    padding: 0 !important; margin: 0 !important; min-height: 0 !important;
    height: 0 !important; border: none !important; background: none !important;
    display: none !important; margin-bottom: -30px !important;
}`;

const DESKTOP_WM = new Set([
    'ding', 'nemo-desktop', 'nautilus-desktop', 'caja-desktop',
]);

const BTN = {
    close:   { n: '#df4a16', h: '#e95420' },
    restore: { n: '#5f5e5a', h: '#7a7974' },
};
const STYLE_BASE = 'border-radius:16px;margin:0 3px;'
                 + 'border:1px solid rgba(0,0,0,.2);transition-duration:150ms;';
const btnStyle = (c) =>
    `background-color:${c};width:16px;height:16px;${STYLE_BASE}`;

const _isX11 = (w) => w?.get_client_type() === Meta.WindowClientType.X11;

// =============================================================================
// PANEL INDICATOR
// =============================================================================
const UnityButtons = GObject.registerClass(
class UnityButtons extends PanelMenu.Button {
    _init(settings, ext) {
        super._init(0.0, 'UnityButtons');
        this._s   = settings;
        this._ext = ext;
        this.style_class = 'unity-panel-button';

        this.menu.setSensitive(false);
        this.menu.actor.hide();

        this._box = new St.BoxLayout({
            style_class: 'unity-container',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const bb = new St.BoxLayout({
            style_class: 'unity-buttons-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        bb.add_child(this._mkBtn('close'));
        bb.add_child(this._mkBtn('restore'));

        this._title = new St.Label({
            style_class: 'unity-title',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(bb);
        this._box.add_child(this._title);
        this.add_child(this._box);

        this._animating  = new Set();
        this._timers     = new Set();
        this._titleWin   = null;
        this._titleSigId = 0;

        this._connectGlobal();
    }

    vfunc_event() { return Clutter.EVENT_PROPAGATE; }

    _mkBtn(type) {
        const c = BTN[type];
        const sN = btnStyle(c.n), sH = btnStyle(c.h);
        const btn = new St.Button({
            style: sN, reactive: true,
            y_align: Clutter.ActorAlign.CENTER, track_hover: true,
        });
        btn.connect('notify::hover', b => { b.style = b.hover ? sH : sN; });
        btn.connect('clicked', () => {
            const w = global.display.get_focus_window();
            if (!w) return;
            if (type === 'close')
                w.delete(global.get_current_time());
            else
                this._doRestore(w);
        });
        return btn;
    }

    // ── Timer management ────────────────────────────────────────────────
    _tm(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(id);
            return fn();
        });
        this._timers.add(id);
        return id;
    }

    _tmCancel(id) {
        if (this._timers.delete(id))
            GLib.source_remove(id);
    }

    _tmCancelAll() {
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
    }

    // =====================================================================
    // SMART UNMAXIMIZE
    // =====================================================================
    _doRestore(win) {
        if (!win || win.get_maximized() !== Meta.MaximizeFlags.BOTH) return;
        const actor = win.get_compositor_private();
        if (!actor) {
            win.unmaximize(Meta.MaximizeFlags.BOTH);
            return;
        }

        if (win._ubLastPos) {
            _log(`Mutter-native: "${win.get_title()}"`);
            win.unmaximize(Meta.MaximizeFlags.BOTH);
            return;
        }

        this._animateRestore(win, actor, true);
    }

    // =====================================================================
    // CLONE-BASED ANTI-JANK ANIMATION
    //
    // For XWayland: unmaximize() is async via X11 protocol. We wait for
    // size-changed before sending move_resize_frame, otherwise the X
    // client ignores the resize request.
    // =====================================================================
    _animateRestore(win, actor, isPreRestore) {
        if (this._animating.has(win)) return;

        const isX = _isX11(win);
        _log(`Animate ${isPreRestore ? 'btn' : 'sig'}: `
           + `"${win.get_title()}" (${isX ? 'X11' : 'Wayland'})`);

        this._animating.add(win);
        win._ubIgnore = true;

        const sx = actor.x, sy = actor.y, sw = actor.width, sh = actor.height;
        const tgt = this._targetRect(win);
        if (!tgt) {
            if (isPreRestore) win.unmaximize(Meta.MaximizeFlags.BOTH);
            win._ubIgnore = false;
            this._animating.delete(win);
            return;
        }

        const clone = new Clutter.Clone({ source: actor });
        clone.set_position(sx, sy);
        clone.set_size(sw, sh);
        actor.opacity = 0;
        global.window_group.add_child(clone);

        // Track whether the unmanaged signal is still connected
        let unmConnected = false;
        let unmId = 0;

        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            this._tmCancel(safety);
            actor.opacity = 255;
            if (clone.get_parent())
                clone.get_parent().remove_child(clone);
            clone.destroy();
            this._animating.delete(win);

            if (unmConnected) {
                win.disconnect(unmId);
                unmConnected = false;
            }

            // Re-focus — XWayland loses focus when actor.opacity was 0
            if (win && !win.minimized) {
                win.activate(global.get_current_time());
                if (isX) {
                    this._tm(50,  () => { win.activate(global.get_current_time()); return GLib.SOURCE_REMOVE; });
                    this._tm(150, () => { win.activate(global.get_current_time()); return GLib.SOURCE_REMOVE; });
                }
            }

            this._tm(100, () => {
                if (win) win._ubIgnore = false;
                return GLib.SOURCE_REMOVE;
            });
        };

        const safety = this._tm(isX ? 3000 : 1500, () => {
            _log('Safety cleanup');
            finish();
            return GLib.SOURCE_REMOVE;
        });

        unmId = win.connect('unmanaged', () => {
            unmConnected = false;
            win.disconnect(unmId);
            finish();
        });
        unmConnected = true;

        if (isPreRestore) win.unmaximize(Meta.MaximizeFlags.BOTH);

        if (isX) {
            this._x11WaitAndMove(win, actor, clone, tgt, finish, () => done);
        } else {
            win.move_resize_frame(true, tgt.x, tgt.y, tgt.width, tgt.height);
            this._tm(10, () => {
                if (done) return GLib.SOURCE_REMOVE;
                win.move_resize_frame(true, tgt.x, tgt.y, tgt.width, tgt.height);
                this._tm(0, () => {
                    if (done) return GLib.SOURCE_REMOVE;
                    this._snapClone(win, actor, clone, finish);
                    return GLib.SOURCE_REMOVE;
                });
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _x11WaitAndMove(win, actor, clone, tgt, finish, isDone) {
        let sizeSignal = 0;
        let timeoutId  = 0;

        const proceed = () => {
            if (sizeSignal) {
                win.disconnect(sizeSignal);
                sizeSignal = 0;
            }
            this._tmCancel(timeoutId);
            if (isDone()) return;

            _log('X11 unmax confirmed, moving to center');
            win.move_resize_frame(true, tgt.x, tgt.y, tgt.width, tgt.height);

            this._tm(50, () => {
                if (isDone()) return GLib.SOURCE_REMOVE;
                win.move_resize_frame(true, tgt.x, tgt.y, tgt.width, tgt.height);
                return GLib.SOURCE_REMOVE;
            });
            this._tm(120, () => {
                if (isDone()) return GLib.SOURCE_REMOVE;
                win.move_resize_frame(true, tgt.x, tgt.y, tgt.width, tgt.height);
                return GLib.SOURCE_REMOVE;
            });
            this._tm(200, () => {
                if (isDone()) return GLib.SOURCE_REMOVE;
                this._snapClone(win, actor, clone, finish);
                return GLib.SOURCE_REMOVE;
            });
        };

        sizeSignal = win.connect('size-changed', () => {
            if (win.get_maximized() === Meta.MaximizeFlags.BOTH) return;
            proceed();
        });

        timeoutId = this._tm(500, () => {
            _log('X11 size-changed timeout, proceeding');
            proceed();
            return GLib.SOURCE_REMOVE;
        });
    }

    _snapClone(win, actor, clone, finish) {
        if (!win || !actor) { finish(); return; }

        const r = win.get_frame_rect();
        win._ubLastPos = { x: r.x, y: r.y, width: r.width, height: r.height };
        _log(`Final: (${actor.x},${actor.y}) ${actor.width}×${actor.height}`);

        clone.ease({
            x: actor.x, y: actor.y,
            width: actor.width, height: actor.height,
            duration: ANIM_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            onComplete: () => finish(),
        });
    }

    _targetRect(win) {
        if (!win) return null;
        const wa  = Main.layoutManager.getWorkAreaForMonitor(win.get_monitor());
        const pct = this._s.get_int('window-size-percent') || 80;
        const w = Math.min(Math.floor(wa.width  * pct / 100), wa.width);
        const h = Math.min(Math.floor(wa.height * pct / 100), wa.height);

        return new Meta.Rectangle({
            x: wa.x + Math.floor((wa.width  - w) / 2),
            y: wa.y + Math.floor((wa.height - h) / 2),
            width: w, height: h,
        });
    }

    // =====================================================================
    // GLOBAL SIGNALS
    // =====================================================================
    _connectGlobal() {
        this._sigFocus = global.display.connect(
            'notify::focus-window', () => this._refresh());

        this._sigCreated = global.display.connect(
            'window-created', (_d, w) => {
                this._tm(50, () => {
                    this._track(w);
                    return GLib.SOURCE_REMOVE;
                });
                this._setupMinSizeWatch(w);
            });

        this._sigWS = global.workspace_manager.connect(
            'active-workspace-changed', () => this._refresh());
        this._sigOvShow = Main.overview.connect('showing', () => {
            this.visible = false;
            this._ext.updateLayout(false);
        });
        this._sigOvHide = Main.overview.connect('hidden',
            () => this._refresh());

        for (const a of global.get_window_actors())
            this._track(a.meta_window);
    }

    // =====================================================================
    // PER-WINDOW TRACKING
    // =====================================================================
    _track(win) {
        if (!win || win._ubTracked) return;
        if (win.get_window_type() !== Meta.WindowType.NORMAL) return;

        _log(`Track: "${win.get_title()}" `
           + `(${win.get_wm_class()}, ${_isX11(win) ? 'X11' : 'Wl'})`);

        win._ubWasMaxH = win.maximized_horizontally;
        win._ubWasMaxV = win.maximized_vertically;

        if (win.get_maximized() !== Meta.MaximizeFlags.BOTH) {
            const r = win.get_frame_rect();
            if (r.width >= 50 && r.height >= 50)
                win._ubOrigSize = { width: r.width, height: r.height };
        } else {
            this._applyXprop(win, true);
        }

        win._ubSigH = win.connect('notify::maximized-horizontally',
            () => this._onMaxToggle(win));
        win._ubSigV = win.connect('notify::maximized-vertically',
            () => this._onMaxToggle(win));

        win._ubSigPos = win.connect('position-changed', () => {
            if (win._ubIgnore || this._animating.has(win)) return;
            if (!win.get_maximized() && win._ubLastPos) {
                const r = win.get_frame_rect();
                if (Math.abs(r.x - win._ubLastPos.x) > 15 ||
                    Math.abs(r.y - win._ubLastPos.y) > 15) {
                    _log(`Manual move → reset "${win.get_title()}"`);
                    delete win._ubLastPos;
                }
            }
        });
        win._ubSigSz = win.connect('size-changed', () => {
            if (win._ubIgnore || this._animating.has(win)) return;
            if (!win.get_maximized() && win._ubLastPos) {
                const r = win.get_frame_rect();
                if (Math.abs(r.width  - win._ubLastPos.width)  > 15 ||
                    Math.abs(r.height - win._ubLastPos.height) > 15) {
                    _log(`Manual resize → reset "${win.get_title()}"`);
                    delete win._ubLastPos;
                }
            }
        });

        win._ubTracked = true;
    }

    _untrack(win) {
        if (!win || !win._ubTracked) return;
        for (const s of ['_ubSigH', '_ubSigV', '_ubSigPos', '_ubSigSz', '_ubMinSzSig']) {
            if (win[s]) {
                win.disconnect(win[s]);
                delete win[s];
            }
        }
        for (const p of ['_ubWasMaxH', '_ubWasMaxV', '_ubOrigSize',
                          '_ubLastPos', '_ubIgnore', '_ubTracked',
                          '_ubMinSzDone', '_ubMinSzOkCount'])
            delete win[p];
    }

    // =====================================================================
    // MINIMUM OPEN SIZE
    //
    // Only applies to windows that have a maximize button (can_maximize).
    // Dialogs, popups, and fixed-size windows are left alone.
    //
    // We keep watching for 3.5s because apps often resize themselves
    // multiple times after creation (theme, content layout, etc.).
    // =====================================================================
    _setupMinSizeWatch(win) {
        if (!win) return;

        const pct = this._s.get_int('min-open-size-percent');
        if (!pct || pct <= 0) return;

        win._ubMinSzOkCount = 0;

        win._ubMinSzSig = win.connect('size-changed', () => {
            this._enforceMinSize(win);
        });

        for (const ms of [200, 500, 800, 1200, 2000, 3000]) {
            this._tm(ms, () => {
                this._enforceMinSize(win);
                return GLib.SOURCE_REMOVE;
            });
        }

        this._tm(3500, () => {
            this._stopMinSizeWatch(win);
            return GLib.SOURCE_REMOVE;
        });
    }

    _enforceMinSize(win) {
        if (!win || win._ubMinSzDone) return;
        if (win.get_maximized()) return;

        // Only enforce on windows that have a maximize button.
        // This excludes dialogs, popups, fixed-size utilities, etc.
        if (!win.can_maximize()) return;

        const pct = this._s.get_int('min-open-size-percent');
        if (!pct || pct <= 0) {
            this._stopMinSizeWatch(win);
            return;
        }

        const r = win.get_frame_rect();
        if (r.width < 10 || r.height < 10) return;

        const wa = Main.layoutManager.getWorkAreaForMonitor(win.get_monitor());
        const mw = Math.floor(wa.width  * pct / 100);
        const mh = Math.floor(wa.height * pct / 100);

        if (r.width >= mw && r.height >= mh) {
            win._ubMinSzOkCount = (win._ubMinSzOkCount || 0) + 1;
            if (win._ubMinSzOkCount >= 2) {
                _log(`Min size OK: "${win.get_title()}" ${r.width}×${r.height}`);
                this._stopMinSizeWatch(win);
            }
            return;
        }

        win._ubMinSzOkCount = 0;
        const nw = Math.max(r.width,  mw);
        const nh = Math.max(r.height, mh);
        const nx = wa.x + Math.floor((wa.width  - nw) / 2);
        const ny = wa.y + Math.floor((wa.height - nh) / 2);

        _log(`Min size: "${win.get_title()}" ${r.width}×${r.height} → ${nw}×${nh}`);

        win._ubIgnore = true;
        win.move_resize_frame(true, nx, ny, nw, nh);

        this._tm(150, () => {
            if (win) win._ubIgnore = false;
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopMinSizeWatch(win) {
        if (!win) return;
        win._ubMinSzDone = true;
        if (win._ubMinSzSig) {
            win.disconnect(win._ubMinSzSig);
            delete win._ubMinSzSig;
        }
        delete win._ubMinSzOkCount;
        win._ubIgnore = false;
        const f = win.get_frame_rect();
        if (f.width >= 50 && f.height >= 50)
            win._ubOrigSize = { width: f.width, height: f.height };
    }

    // =====================================================================
    // MAX ↔ UNMAX TRANSITIONS
    // =====================================================================
    _onMaxToggle(win) {
        const mH = win.maximized_horizontally;
        const mV = win.maximized_vertically;
        const isMax  = win.get_maximized() === Meta.MaximizeFlags.BOTH;
        const wasMax = win._ubWasMaxH && win._ubWasMaxV;

        if (mH === win._ubWasMaxH && mV === win._ubWasMaxV) return;

        if (!wasMax && isMax) {
            const r   = win.get_frame_rect();
            const mon = global.display.get_monitor_geometry(win.get_monitor());
            if (r.width >= 50 && r.height >= 50 && r.width < mon.width) {
                win._ubOrigSize = { width: r.width, height: r.height };
                _log(`Pre-max: ${r.width}×${r.height} "${win.get_title()}"`);
            }
            this._applyXprop(win, true);
        }

        if (wasMax && !isMax) {
            _log(`Sig unmax: "${win.get_title()}"`);
            this._applyXprop(win, false);

            if (!this._animating.has(win)) {
                GLib.idle_add(GLib.PRIORITY_HIGH, () => {
                    if (win && !win.get_maximized() && !win._ubLastPos) {
                        const a = win.get_compositor_private();
                        if (a) this._animateRestore(win, a, false);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        win._ubWasMaxH = mH;
        win._ubWasMaxV = mV;
        this._refresh();
    }

    _applyXprop(win, hide) {
        if (!_isX11(win)) return;
        const m = win.get_description()?.match(/0x[0-9a-fA-F]+/);
        if (!m) return;
        try {
            Gio.Subprocess.new(
                ['xprop', '-id', m[0],
                 '-f', '_MOTIF_WM_HINTS', '32c',
                 '-set', '_MOTIF_WM_HINTS',
                 hide ? '2, 0, 0, 0, 0' : '2, 0, 1, 0, 0'],
                Gio.SubprocessFlags.NONE);
        } catch (e) {
            _log(`xprop failed: ${e.message}`);
        }
    }

    // ── Panel visibility ────────────────────────────────────────────────
    _refresh() {
        const win = global.display.get_focus_window();

        if (!win || win.minimized
            || win.get_window_type() !== Meta.WindowType.NORMAL
            || DESKTOP_WM.has((win.get_wm_class() || '').toLowerCase())
            || Main.overview.visible
            || !win.located_on_workspace(
                   global.workspace_manager.get_active_workspace())
            || win.skip_taskbar) {
            this.visible = false;
            this._ext.updateLayout(false);
            this._disconnTitle();
            return;
        }

        const isMax = win.get_maximized() === Meta.MaximizeFlags.BOTH;
        this.visible = isMax;
        if (isMax) this._title.text = win.get_title() || '';
        this._ext.updateLayout(isMax);

        if (isMax && win !== this._titleWin) {
            this._disconnTitle();
            this._titleWin   = win;
            this._titleSigId = win.connect('notify::title', () => {
                if (this.visible) this._title.text = win.get_title() || '';
            });
        } else if (!isMax) {
            this._disconnTitle();
        }
    }

    _disconnTitle() {
        if (this._titleSigId && this._titleWin) {
            this._titleWin.disconnect(this._titleSigId);
            this._titleSigId = 0;
            this._titleWin   = null;
        }
    }

    // ── Cleanup ─────────────────────────────────────────────────────────
    destroy() {
        this._disconnTitle();
        this._tmCancelAll();

        for (const a of global.get_window_actors()) {
            if (a.meta_window) this._untrack(a.meta_window);
            if (a.opacity === 0) a.opacity = 255;
        }

        if (this._sigFocus)   global.display.disconnect(this._sigFocus);
        if (this._sigCreated) global.display.disconnect(this._sigCreated);
        if (this._sigWS)      global.workspace_manager.disconnect(this._sigWS);
        if (this._sigOvShow)  Main.overview.disconnect(this._sigOvShow);
        if (this._sigOvHide)  Main.overview.disconnect(this._sigOvHide);

        this._animating.clear();
        super.destroy();
    }
});

// =============================================================================
// EXTENSION ENTRY POINT
// =============================================================================
export default class UnityButtonsExtension extends Extension {
    enable() {
        this._settings   = this.getSettings();
        this._wmSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.wm.preferences',
        });
        this._updating = false;

        const dir  = GLib.build_filenamev([
            GLib.get_user_cache_dir(), 'unity-buttons']);
        const path = GLib.build_filenamev([dir, 'layout.txt']);
        this._cache = Gio.File.new_for_path(path);
        GLib.mkdir_with_parents(dir, 0o755);

        const cur = this._wmSettings.get_string('button-layout');
        if (cur !== ':') {
            this._layout = cur;
            this._cacheWrite(cur);
            this._settings.set_string('original-layout-cache', cur);
        } else {
            this._layout = this._cacheRead()
                || this._settings.get_string('original-layout-cache')
                || 'close,minimize,maximize:';
        }

        this._wmSigId = this._wmSettings.connect(
            'changed::button-layout', () => {
                if (this._updating) return;
                const v = this._wmSettings.get_string('button-layout');
                if (v && v !== ':') {
                    this._layout = v;
                    this._settings.set_string('original-layout-cache', v);
                    this._cacheWrite(v);
                }
            });

        this._applyGtkHack(true);
        this._indicator = new UnityButtons(this._settings, this);
        Main.panel.addToStatusArea(
            'unity-buttons', this._indicator, 0, 'left');
    }

    disable() {
        if (this._wmSigId) this._wmSettings.disconnect(this._wmSigId);
        this._applyGtkHack(false);

        const saved = this._cacheRead()
            || this._settings.get_string('original-layout-cache');
        if (saved && saved !== ':') {
            this._updating = true;
            this._wmSettings.set_string('button-layout', saved);
            this._updating = false;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings   = null;
        this._wmSettings = null;
    }

    updateLayout(hide) {
        const want = hide ? ':' : this._layout;
        if (this._wmSettings.get_string('button-layout') !== want) {
            this._updating = true;
            this._wmSettings.set_string('button-layout', want);
            this._updating = false;
        }
    }

    _cacheWrite(s) {
        try {
            this._cache.replace_contents(
                s, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            _log(`Cache write failed: ${e.message}`);
        }
    }

    _cacheRead() {
        try {
            if (!this._cache.query_exists(null)) return null;
            const [ok, d] = this._cache.load_contents(null);
            return ok ? new TextDecoder().decode(d).trim() : null;
        } catch (e) {
            return null;
        }
    }

    _applyGtkHack(on) {
        try {
            const dir  = GLib.build_filenamev([
                GLib.get_user_config_dir(), 'gtk-3.0']);
            const path = GLib.build_filenamev([dir, 'gtk.css']);
            GLib.mkdir_with_parents(dir, 0o755);
            const file = Gio.File.new_for_path(path);

            let css = '';
            if (file.query_exists(null)) {
                const [ok, raw] = file.load_contents(null);
                if (ok) css = new TextDecoder().decode(raw);
            }
            css = css.replace(
                /\/\* --- UNITY-HACK --- \*\/[\s\S]*\/\* --- END-UNITY-HACK --- \*\//g,
                '').trim();
            if (on)
                css += '\n\n/* --- UNITY-HACK --- */\n'
                     + LO_HACK
                     + '\n/* --- END-UNITY-HACK --- */';
            file.replace_contents(
                css.trim(), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            _log(`GTK hack failed: ${e.message}`);
        }
    }
}

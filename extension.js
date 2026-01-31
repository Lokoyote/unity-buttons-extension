import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

const UnityButtons = GObject.registerClass(
class UnityButtons extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'UnityButtons');
        this.add_style_class_name('unity-panel-button');
        
        // Visual settings
        this.reactive = false;
        this.can_focus = false;
        this.track_hover = false;

        this._container = new St.BoxLayout({ 
            style_class: 'unity-container', 
            reactive: false 
        });
        
        this._btnBox = new St.BoxLayout({ style: 'spacing: 6px;' });

        const createBtn = (color, hoverColor, action) => {
            let btn = new St.Button({
                style: `background-color: ${color};`,
                style_class: 'unity-button',
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
                track_hover: true
            });
            btn.connect('notify::hover', () => {
                btn.set_style(`background-color: ${btn.hover ? hoverColor : color};`);
            });
            btn.connect('clicked', action);
            return btn;
        };

        // Close button
        this._btnBox.add_child(createBtn('#FFB347', '#FF8C00', () => {
            let win = global.display.get_focus_window();
            if (win) win.delete(global.get_current_time());
        }));

        // Unmaximize button
        this._btnBox.add_child(createBtn('#C0C0C0', '#808080', () => {
            let win = global.display.get_focus_window();
            if (win) win.unmaximize(Meta.MaximizeFlags.BOTH);
        }));

        this._titleLabel = new St.Label({
            style_class: 'unity-title',
            y_align: Clutter.ActorAlign.CENTER
        });

        this._container.add_child(this._btnBox);
        this._container.add_child(this._titleLabel);
        this.add_child(this._container);

        this._currentWin = null;

        // Use connectObject instead of storing signal IDs
        global.display.connectObject(
            'notify::focus-window', () => this._updateAll(),
            this
        );
        
        global.window_manager.connectObject(
            'size-change', () => this._updateAll(),
            this
        );

        this._updateAll();
    }

    _updateAll() {
        let win = global.display.get_focus_window();
        let title = win ? win.get_title() : "";

        // Ignore Desktop Icons window and check maximization
        let isDesktop = title && title.includes("Desktop Icons");
        let isMax = win && win.get_maximized() === Meta.MaximizeFlags.BOTH;
        let isNormal = win && win.get_window_type() === Meta.WindowType.NORMAL;

        this.visible = isNormal && isMax && !isDesktop;

        // Cleanup old window title signal
        if (this._currentWin) {
            this._currentWin.disconnectObject(this);
        }

        if (this.visible) {
            this._currentWin = win;
            this._titleLabel.set_text(title);
            this._titleLabel.show();
            
            // Connect to title changes on the specific window
            this._currentWin.connectObject('notify::title', () => {
                this._titleLabel.set_text(this._currentWin.get_title());
            }, this);
        } else {
            this._titleLabel.hide();
            this._currentWin = null;
        }
        
        if (this._extParent) {
            this._extParent.updateSystemButtons(this.visible);
        }
    }

    destroy() {
        if (this._currentWin) {
            this._currentWin.disconnectObject(this);
        }
        super.destroy();
    }
});

export default class UnityButtonsExtension extends Extension {
    async enable() {
        this._settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.wm.preferences' });
        this._configFile = Gio.File.new_for_path(this.path + '/last_layout.txt');
        this._isInternalChange = false;

        // Load saved layout using async method
        let current = this._settings.get_string('button-layout');
        if (current && current !== ':' && !this._configFile.query_exists(null)) {
            this._saveToDisk(current);
        }

        this._indicator = new UnityButtons();
        this._indicator._extParent = this;
        Main.panel.addToStatusArea('unity-buttons-v2', this._indicator, 0, 'left');
    }

    updateSystemButtons(hideOnWindow) {
        if (!this._settings || this._isInternalChange) return;

        this._getSavedLayoutAsync().then(layout => {
            let targetLayout = hideOnWindow ? ':' : layout;
            if (this._settings.get_string('button-layout') === targetLayout) return;

            this._isInternalChange = true;
            this._settings.set_string('button-layout', targetLayout);
            this._isInternalChange = false;
        }).catch(logError);
    }

    // Async file reading to avoid blocking the shell
    async _getSavedLayoutAsync() {
        try {
            if (this._configFile.query_exists(null)) {
                let [success, contents] = await this._configFile.load_contents_async(null);
                if (success) return new TextDecoder().decode(contents).trim();
            }
        } catch (e) {
            console.error(e);
        }
        return 'close,minimize,maximize:';
    }

    _saveToDisk(layout) {
        try {
            this._configFile.replace_contents_async(
                layout, null, false, Gio.FileCreateFlags.NONE, null, null
            );
        } catch (e) {}
    }

    disable() {
        if (this._settings) {
            this._isInternalChange = true;
            // Restore default or saved layout
            this._getSavedLayoutAsync().then(layout => {
                if (this._settings) this._settings.set_string('button-layout', layout);
            });
            this._isInternalChange = false;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}

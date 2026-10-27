/**
 * This file is part of Hide Top Bar
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Hides the panels that other extensions put on the non-primary monitors
// (Multi Monitors Bar, Multi Monitors Add-On) by the same rules as the top
// bar: intellihide on the panel's own monitor, pressure at the screen edge,
// shown in the overview. Such a panel is recognised as a chrome actor named
// "panelBox" directly in Main.uiGroup whose child carries a `monitorIndex`.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';

import * as Convenience from './convenience.js';
import * as Intellihide from './intellihide.js';
const DEBUG = Convenience.DEBUG;

const ShellActionMode = (
    Shell.ActionMode ? Shell.ActionMode : Shell.KeyBindingMode
);

function findPanel(box) {
    return box.get_children().find(
        child => Number.isInteger(child.monitorIndex)
    ) ?? null;
}

// Re-registers `box` as chrome, keeping it just below the main panel box where
// those extensions put it. Struts are what keep maximized windows below the
// panel, so a hidden panel must not have them.
function setStruts(box, affectsStruts) {
    Main.layoutManager.removeChrome(box);
    Main.layoutManager.addChrome(box, {affectsStruts, trackFullscreen: true});
    Main.uiGroup.set_child_below_sibling(box, Main.layoutManager.panelBox);
}

class SecondaryPanel {
    constructor(settings, box, panel) {
        this._settings = settings;
        this._box = box;
        this._panel = panel;
        this._monitorIndex = panel.monitorIndex;
        this._preventHide = false;
        this._intellihideBlock = false;
        this._animationActive = false;
        this._unredirectDisabled = false;
        this._pointerListener = null;
        this._blockerMenu = null;
        this._menuEvent = null;
        this._barrier = null;
        this._pressure = null;
        this._staticBox = new Clutter.ActorBox();
        this._cursorTracker = Convenience.getCursorTracker();

        this._intellihide = new Intellihide.Intellihide(
            this._settings, this._monitorIndex,
        );

        this._signalsHandler = new Convenience.GlobalSignalsHandler();
        this._signalsHandler.add(
            [this._intellihide, 'status-changed',
                this._updatePreventHide.bind(this)],
            [Main.overview, 'showing', () => {
                if (this._settings.get_boolean('show-in-overview'))
                    this.show(
                        this._settings.get_double('animation-time-overview'),
                        "showing-overview");
            }],
            [Main.overview, 'hiding', () => this.hide(
                this._settings.get_double('animation-time-overview'),
                "hiding-overview")],
            // The layout manager shows every chrome actor again once the
            // overview has closed.
            [Main.overview, 'hidden', () => {
                if (!this._animationActive && this._box.translation_y !== 0)
                    this._hideOffscreen();
            }],
            [panel, 'leave-event', this._handleMenus.bind(this)],
            // The allocation ignores the translation the panel slides by, so
            // this only fires when the panel itself is moved or resized.
            [box, 'notify::allocation', () => {
                this._updateStaticBox();
                this._updatePressureBarrier();
            }],
            [this._settings, 'changed::mouse-sensitive',
                this._updatePressureBarrier.bind(this)],
            [this._settings, 'changed::pressure-threshold',
                this._updatePressureBarrier.bind(this)],
            [this._settings, 'changed::pressure-timeout',
                this._updatePressureBarrier.bind(this)],
            [this._settings, 'changed::enable-intellihide',
                this._updateIntellihideStatus.bind(this)],
            [this._settings, 'changed::enable-active-window',
                this._updateIntellihideStatus.bind(this)],
        );

        setStruts(box, false);
        this._updateStaticBox();
        this._updatePressureBarrier();
        this._updateIntellihideStatus();
    }

    // Whether the panel sits at the bottom of its monitor rather than the top.
    _atBottom() {
        const monitor = Main.layoutManager.monitors[this._monitorIndex];
        if (!monitor)
            return false;
        return this._box.y + this._box.height / 2
            > monitor.y + monitor.height / 2;
    }

    hide(animationTime, trigger) {
        DEBUG(`secondary ${this._monitorIndex}: hide(${trigger})`);
        if (this._preventHide)
            return;
        if (trigger === "mouse-left" && this._isHovering(...global.get_pointer()))
            return;

        this._stopWatchingPointer();
        this._box.remove_all_transitions();
        this._animationActive = true;
        const height = this._box.height;
        this._box.ease({
            translation_y: this._atBottom() ? height : -height,
            duration: animationTime * 1000,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._animationActive = false;
                this._hideOffscreen();
                this._setUnredirectDisabled(false);
            },
        });
    }

    // Off its own monitor the panel would show on a monitor above or below;
    // it is only kept visible for its corners.
    _hideOffscreen() {
        if (!this._settings.get_boolean('keep-round-corners'))
            this._box.hide();
    }

    show(animationTime, trigger) {
        DEBUG(`secondary ${this._monitorIndex}: show(${trigger})`);
        this._box.remove_all_transitions();
        this._box.show();
        this._setUnredirectDisabled(true);
        this._animationActive = true;
        this._box.ease({
            translation_y: 0,
            duration: animationTime * 1000,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._animationActive = false;
                if (!this._isHovering(...global.get_pointer()))
                    this._handleMenus();
                else if (!this._pointerListener)
                    this._pointerListener = this._cursorTracker.connect(
                        'position-invalidated',
                        () => this._handlePointer(...global.get_pointer()),
                    );
            },
        });
    }

    _setUnredirectDisabled(disabled) {
        if (disabled === this._unredirectDisabled)
            return;
        Convenience.setUnredirect(!disabled);
        this._unredirectDisabled = disabled;
    }

    _isHovering(x, y) {
        return x >= this._staticBox.x1 && x < this._staticBox.x2
            && y >= this._staticBox.y1 && y < this._staticBox.y2;
    }

    _stopWatchingPointer() {
        if (this._pointerListener) {
            this._cursorTracker.disconnect(this._pointerListener);
            this._pointerListener = null;
        }
    }

    _handlePointer(x, y) {
        if (!this._animationActive && !this._isHovering(x, y))
            this._handleMenus();
    }

    _handleMenus() {
        if (Main.overview.visible || this._blockerMenu)
            return;
        const blocker = this._panel.menuManager?.activeMenu ?? null;
        if (!blocker) {
            this.hide(
                this._settings.get_double('animation-time-autohide'),
                "mouse-left");
            return;
        }
        this._blockerMenu = blocker;
        this._menuEvent = blocker.connect('open-state-changed', (menu, open) => {
            if (open)
                return;
            this._disconnectBlockerMenu();
            this._handleMenus();
        });
    }

    _disconnectBlockerMenu() {
        if (this._blockerMenu) {
            this._blockerMenu.disconnect(this._menuEvent);
            this._blockerMenu = null;
            this._menuEvent = null;
        }
    }

    // The panel extensions give the box a fixed position and size, which hold
    // before it is allocated; re-adding it as chrome drops its allocation and
    // the relayout may not emit notify::allocation if nothing moved.
    _hasGeometry() {
        return this._box.width > 0 && this._box.height > 0;
    }

    _updateStaticBox() {
        if (!this._hasGeometry())
            return;
        this._staticBox.init_rect(
            this._box.x, this._box.y, this._box.width, this._box.height);
        this._intellihide.updateTargetBox(this._staticBox);
    }

    _disablePressureBarrier() {
        if (this._barrier) {
            this._pressure.removeBarrier(this._barrier);
            this._barrier.destroy();
            this._barrier = null;
        }
        this._pressure?.destroy();
        this._pressure = null;
    }

    _updatePressureBarrier() {
        this._disablePressureBarrier();
        if (!this._settings.get_boolean('mouse-sensitive')
            || !this._hasGeometry())
            return;

        this._pressure = new Layout.PressureBarrier(
            this._settings.get_int('pressure-threshold'),
            this._settings.get_int('pressure-timeout'),
            ShellActionMode.NORMAL,
        );
        this._pressure.connect('trigger', () => {
            if (Main.layoutManager.monitors[this._monitorIndex]?.inFullscreen
                && !this._settings.get_boolean(
                    'mouse-sensitive-fullscreen-window'))
                return;
            this.show(
                this._settings.get_double('animation-time-autohide'),
                "mouse-enter");
        });

        const atBottom = this._atBottom();
        const y = atBottom ? this._box.y + this._box.height : this._box.y;
        this._barrier = new Meta.Barrier({
            ...(Convenience.shellVersion === 45
                ? {display: global.display} : {backend: global.backend}),
            x1: this._box.x,
            x2: this._box.x + this._box.width,
            y1: y,
            y2: y,
            directions: atBottom
                ? Meta.BarrierDirection.NEGATIVE_Y
                : Meta.BarrierDirection.POSITIVE_Y,
        });
        this._pressure.addBarrier(this._barrier);
    }

    _updateIntellihideStatus() {
        this._preventHide = false;
        if (this._settings.get_boolean('enable-intellihide')) {
            this._intellihideBlock = false;
            this._intellihide.enable();
        } else {
            this._intellihide.disable();
            this._intellihideBlock = true;
            this.hide(0, "init");
        }
    }

    _updatePreventHide() {
        if (this._intellihideBlock)
            return;
        this._preventHide = !this._intellihide.getOverlapStatus();
        const animTime = this._settings.get_double('animation-time-autohide');
        if (this._preventHide) {
            if (this._settings.get_boolean('show-in-overview')
                || !Main.overview.visible)
                this.show(animTime, "intellihide");
        } else if (!Main.overview.visible) {
            this.hide(animTime, "intellihide");
        }
    }

    // `boxGone`: the owning extension is removing the panel itself.
    destroy(boxGone) {
        this._signalsHandler.destroy();
        this._intellihide.destroy();
        this._disablePressureBarrier();
        this._stopWatchingPointer();
        this._disconnectBlockerMenu();
        this._setUnredirectDisabled(false);
        if (boxGone)
            return;
        this._box.remove_all_transitions();
        this._box.translation_y = 0;
        this._box.show();
        setStruts(this._box, true);
    }
}

export class SecondaryPanelsManager {
    constructor(settings) {
        this._settings = settings;
        // panelBox actor -> {panel: SecondaryPanel, destroyId}
        this._panels = new Map();
        this._restructuring = false;
        this._syncId = 0;

        this._signalsHandler = new Convenience.GlobalSignalsHandler();
        this._signalsHandler.add(
            [Main.uiGroup, 'child-added', this._queueSync.bind(this)],
            [Main.uiGroup, 'child-removed', this._queueSync.bind(this)],
            // Indices and edges change: start over with every panel.
            [Main.layoutManager, 'monitors-changed', () => {
                this._clear();
                this._queueSync();
            }],
        );
        this._sync();
    }

    _queueSync() {
        // setStruts() takes the panel out of uiGroup and puts it back.
        if (this._restructuring || this._syncId)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const primary = Main.layoutManager.primaryIndex;
        const boxes = Main.uiGroup.get_children().filter(
            actor => actor.name === 'panelBox'
                && actor !== Main.layoutManager.panelBox
        );

        for (const [box, entry] of this._panels) {
            if (!boxes.includes(box))
                this._drop(box, entry, true);
        }

        for (const box of boxes) {
            if (this._panels.has(box))
                continue;
            const panel = findPanel(box);
            if (!panel || panel.monitorIndex === primary)
                continue;
            this._restructuring = true;
            try {
                const entry = {panel: new SecondaryPanel(this._settings, box, panel)};
                entry.destroyId = box.connect('destroy',
                    () => this._drop(box, entry, true));
                this._panels.set(box, entry);
            } finally {
                this._restructuring = false;
            }
        }
    }

    _drop(box, entry, boxGone) {
        this._panels.delete(box);
        box.disconnect(entry.destroyId);
        this._restructuring = true;
        try {
            entry.panel.destroy(boxGone);
        } finally {
            this._restructuring = false;
        }
    }

    _clear() {
        for (const [box, entry] of this._panels)
            this._drop(box, entry, false);
    }

    destroy() {
        if (this._syncId) {
            GLib.source_remove(this._syncId);
            this._syncId = 0;
        }
        this._signalsHandler.destroy();
        this._clear();
    }
}

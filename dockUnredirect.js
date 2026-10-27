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

// Without the top bar's strut a maximized window covers its whole monitor, so
// Mutter may unredirect it (X11) or scan it out directly (Wayland) and skip
// painting the stage. Dash to Dock only keeps the stage painted while it is
// shown above a fullscreen window, so above such a maximized window its dock
// would vanish shortly after it slid in, although it still took the pointer.
// Keep the stage painted while a Dash to Dock dock is on screen above a
// window, which is only the case when it was revealed over one.

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Convenience from './convenience.js';

const DOCK_NAME = 'dashtodockContainer';
const DOCK_HIDDEN = 0;  // Dash to Dock's State.HIDDEN

export class DockUnredirect {
    constructor() {
        // dock actor -> signal ids
        this._docks = new Map();
        this._inhibited = false;
        this._syncId = 0;

        this._signalsHandler = new Convenience.GlobalSignalsHandler();
        this._signalsHandler.add(
            [Main.uiGroup, 'child-added', this._queueSync.bind(this)],
            [Main.uiGroup, 'child-removed', this._queueSync.bind(this)],
        );
        this._sync();
    }

    _queueSync() {
        if (this._syncId)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        const docks = Main.uiGroup.get_children().filter(
            actor => actor.name === DOCK_NAME && 'dockState' in actor);

        for (const dock of [...this._docks.keys()]) {
            if (!docks.includes(dock))
                this._untrack(dock);
        }
        for (const dock of docks) {
            if (this._docks.has(dock))
                continue;
            const update = this._update.bind(this);
            const intellihide = dock._intellihide;
            this._docks.set(dock, {
                ids: [
                    dock.connect('notify::dock-state', update),
                    dock.connect('notify::visible', update),
                    dock.connect('destroy', () => {
                        this._untrack(dock);
                        this._update();
                    }),
                ],
                intellihide,
                intellihideId: intellihide?.connect?.('status-changed', update),
            });
        }
        this._update();
    }

    _untrack(dock) {
        const entry = this._docks.get(dock);
        if (!entry)
            return;
        for (const id of entry.ids)
            dock.disconnect(id);
        if (entry.intellihideId)
            entry.intellihide.disconnect(entry.intellihideId);
        this._docks.delete(dock);
    }

    _update() {
        const inhibit = [...this._docks.keys()].some(
            dock => dock.visible && dock.dockState !== DOCK_HIDDEN
                && (dock._intellihide?.getOverlapStatus?.() ?? true));
        this._setInhibited(inhibit);
    }

    _setInhibited(inhibit) {
        if (inhibit === this._inhibited)
            return;
        Convenience.setUnredirect(!inhibit);
        this._inhibited = inhibit;
    }

    destroy() {
        if (this._syncId) {
            GLib.source_remove(this._syncId);
            this._syncId = 0;
        }
        this._signalsHandler.destroy();
        for (const dock of [...this._docks.keys()])
            this._untrack(dock);
        this._setInhibited(false);
    }
}

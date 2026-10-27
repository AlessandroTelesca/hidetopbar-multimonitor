/**
 * Hide Top Bar: Multi Monitors companion
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// Runs only while Hide Top Bar (hidetopbar@mathieu.bidon.ca) is active, and
// uses its settings, so Hide Top Bar itself stays unmodified and can update
// from extensions.gnome.org.

import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as SecondaryPanels from './secondaryPanels.js';
import * as DockUnredirect from './dockUnredirect.js';

const HIDETOPBAR_UUID = 'hidetopbar@mathieu.bidon.ca';
const HIDETOPBAR_SCHEMA = 'org.gnome.shell.extensions.hidetopbar';
const ACTIVE = ExtensionState.ACTIVE ?? ExtensionState.ENABLED;

export default class HideTopBarMultiMonitorsExtension extends Extension {
    enable() {
        this._secondaryPanels = null;
        this._dockUnredirect = null;
        this._stateId = Main.extensionManager.connect(
            'extension-state-changed', (manager, ext) => {
                if (ext.uuid === HIDETOPBAR_UUID)
                    this._sync();
            });
        this._sync();
    }

    disable() {
        Main.extensionManager.disconnect(this._stateId);
        this._stateId = 0;
        this._stop();
    }

    _sync() {
        const ext = Main.extensionManager.lookup(HIDETOPBAR_UUID);
        if (ext?.state === ACTIVE)
            this._start(ext);
        else
            this._stop();
    }

    // Hide Top Bar's own schema, read from its install directory so the
    // settings it shows in its preferences are the ones used here.
    _hideTopBarSettings(ext) {
        const dir = ext.dir.get_child('schemas');
        const source = dir.query_exists(null)
            ? Gio.SettingsSchemaSource.new_from_directory(
                dir.get_path(), Gio.SettingsSchemaSource.get_default(), false)
            : Gio.SettingsSchemaSource.get_default();
        const schema = source?.lookup(HIDETOPBAR_SCHEMA, true);
        if (!schema)
            throw new Error(`${HIDETOPBAR_SCHEMA} not found in ${dir.get_path()}`);
        return new Gio.Settings({settings_schema: schema});
    }

    _start(ext) {
        if (this._secondaryPanels)
            return;
        this._settings = this._hideTopBarSettings(ext);
        this._secondaryPanels = new SecondaryPanels.SecondaryPanelsManager(this._settings);
        this._dockUnredirect = new DockUnredirect.DockUnredirect();
    }

    _stop() {
        this._dockUnredirect?.destroy();
        this._secondaryPanels?.destroy();
        this._dockUnredirect = null;
        this._secondaryPanels = null;
        this._settings = null;
    }
}

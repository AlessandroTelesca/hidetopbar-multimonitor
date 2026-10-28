/**
 * Hide Top Bar: Multi Monitors companion
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// While a secondary panel is hidden, shows its clock where the panel's clock
// sits. Fades in as the panel slides away: SecondaryPanel eases the box's
// translation_y to ±height and then hides the box. Moving the pointer onto the
// clock hides it for SNOOZE_SECONDS.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Convenience from './convenience.js';

const SNOOZE_SECONDS = 30;

export class HiddenClock {
    constructor(box, panel) {
        this._box = box;
        this._source = null;
        this._ownSource = false;
        this._binding = null;
        this._snoozeId = 0;

        this._label = new St.Label({style_class: 'hidetopbar-mm-clock'});
        this._clock = new St.Bin({
            child: this._label,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: false,
        });
        // Not `hover`: turning non-reactive under the pointer leaves it set
        // (no leave event comes), so the next entry would not notify.
        this._clock.connect('enter-event', () => {
            this._snooze();
            return Clutter.EVENT_PROPAGATE;
        });
        // A strip over the panel's band that centers the clock by layout, so
        // nothing has to follow the clock's own size.
        this._actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
            opacity: 0,
        });
        this._actor.add_child(this._clock);
        // Only the clock takes the pointer, and only while it shows:
        // elsewhere in the strip pointer events go to the windows underneath.
        Main.layoutManager.addChrome(this._actor, {trackFullscreen: true});
        // The panel slides over the clock as it comes back.
        Main.uiGroup.set_child_below_sibling(this._actor, box);

        this._signalsHandler = new Convenience.GlobalSignalsHandler();
        this._signalsHandler.add(
            [box, 'notify::translation-y', this._updateOpacity.bind(this)],
            [box, 'notify::visible', this._updateOpacity.bind(this)],
            // The allocation ignores the slide, so this only fires when the
            // panel is moved or resized.
            [box, 'notify::allocation', this._updateGeometry.bind(this)],
        );

        this._setSource(panel.statusArea?.dateMenu?._clockDisplay ?? null);
        this._updateGeometry();
        this._updateOpacity();
    }

    // `own`: the panel's own clock label; without it, the top bar's clock
    // supplies the text and the label stays centered on the monitor.
    _setSource(own) {
        this._dropSource();
        this._ownSource = !!own;
        this._source = own ?? Main.panel.statusArea.dateMenu._clockDisplay;
        this._binding = this._source.bind_property('text', this._label, 'text',
            GObject.BindingFlags.SYNC_CREATE);
        this._signalsHandler.addWithLabel('source',
            [this._source, 'style-changed', this._updateFont.bind(this)],
            [this._source, 'notify::allocation', this._updateOffset.bind(this)],
            [this._source, 'destroy', () => {
                if (this._ownSource)
                    this._setSource(null);
                else
                    this._dropSource();
            }],
        );
        this._updateFont();
        this._updateOffset();
    }

    _dropSource() {
        this._signalsHandler.disconnectWithLabel('source');
        this._binding?.unbind();
        this._binding = null;
        this._source = null;
    }

    _updateGeometry() {
        const {x, y, width, height} = this._box;
        this._actor.set_position(x, y);
        this._actor.set_size(width, height);
        this._updateOffset();
    }

    // Shift the clock from the strip's center to the panel clock's center.
    _updateOffset() {
        const source = this._source;
        if (!this._ownSource || !(source?.width > 0)) {
            this._clock.translation_x = 0;
            return;
        }
        const [sourceX] = source.get_transformed_position();
        const center = this._box.x + this._box.width / 2;
        const offset = Math.round(sourceX + source.width / 2 - center);
        // NaN before the panel clock is on stage; its allocation comes later.
        this._clock.translation_x = Number.isFinite(offset) ? offset : 0;
    }

    // Hides the clock; it comes back after SNOOZE_SECONDS if the panel is
    // still hidden then. The clock is not reactive while hidden, so the
    // pointer cannot restart the timer; if the pointer is still on it when the
    // timer ends, it hides again at once.
    _snooze() {
        if (this._snoozeId)
            return;
        this._snoozeId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            SNOOZE_SECONDS, () => {
                this._snoozeId = 0;
                this._updateOpacity();
                return GLib.SOURCE_REMOVE;
            });
        this._updateOpacity();
    }

    // Opacity only: the layout manager owns `visible` of trackFullscreen chrome.
    _updateOpacity() {
        const box = this._box;
        let hidden;
        if (this._snoozeId)
            hidden = 0;
        else if (!box.visible)
            hidden = 1;
        else if (box.height > 0)
            hidden = Math.min(1, Math.abs(box.translation_y) / box.height);
        else
            hidden = 0;
        this._actor.opacity = Math.round(hidden * 255);
        const reactive = this._actor.opacity > 0;
        if (this._clock.reactive !== reactive) {
            this._clock.reactive = reactive;
            // Clutter only re-picks the actor under the pointer after a
            // relayout: without one, a clock that comes back under a resting
            // pointer would not notice it.
            this._actor.queue_relayout();
        }
    }

    _updateFont() {
        const font = this._source?.peek_theme_node()?.get_font();
        if (!font)
            return;
        const unit = font.get_size_is_absolute() ? 'px' : 'pt';
        this._label.style = `font-family: "${font.get_family()}"; ` +
            `font-size: ${font.get_size() / Pango.SCALE}${unit}; ` +
            `font-weight: ${font.get_weight()};`;
    }

    destroy() {
        if (this._snoozeId) {
            GLib.source_remove(this._snoozeId);
            this._snoozeId = 0;
        }
        this._dropSource();
        this._signalsHandler.destroy();
        Main.layoutManager.removeChrome(this._actor);
        this._actor.destroy();
    }
}

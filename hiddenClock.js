/**
 * Hide Top Bar: Multi Monitors companion
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// While a secondary panel is hidden, shows its clock where the panel's clock
// sits, on a tab that grows out of the screen edge the panel hides behind.
// Fades in as the panel slides away: SecondaryPanel eases the box's
// translation_y to ±height and then hides the box. The clock hides while the
// pointer is on it, and comes back REVEAL_DELAY_MS after the pointer leaves.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as Convenience from './convenience.js';

const REVEAL_DELAY_MS = 1000;
// How far the tab's corners at the screen edge curve outward into it, px.
const EDGE_FLARE = 12;
// The tab's colour, which the label's text is drawn on.
const TAB_RGBA = [0, 0, 0, 0.55];

export class HiddenClock {
    constructor(box, panel) {
        this._box = box;
        this._monitorIndex = panel.monitorIndex;
        this._atBottom = false;
        this._source = null;
        this._ownSource = false;
        this._binding = null;
        this._pointerHidden = false;
        this._pointerId = 0;
        this._revealId = 0;
        this._cursorTracker = Convenience.getCursorTracker();

        // The label's padding leaves room for the tab's flares on its sides.
        this._label = new St.Label({style_class: 'hidetopbar-mm-clock'});
        this._tab = new St.DrawingArea({x_expand: true, y_expand: true});
        this._tab.connect('repaint', this._drawTab.bind(this));
        this._clock = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            reactive: false,
        });
        this._clock.add_child(this._tab);
        this._clock.add_child(this._label);
        // Not `hover`: turning non-reactive under the pointer leaves it set
        // (no leave event comes), so the next entry would not notify.
        this._clock.connect('enter-event', () => {
            this._hideUnderPointer();
            return Clutter.EVENT_PROPAGATE;
        });
        // A strip across the panel's band, as tall as the clock and against the
        // screen edge, that centers the clock by layout.
        this._actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
            opacity: 0,
        });
        this._actor.add_child(this._clock);
        // Only the clock takes the pointer, and only while it shows:
        // elsewhere in the strip pointer events go to the windows underneath.
        // Not trackFullscreen: the layout manager places that chrome on a
        // monitor by where it is drawn, and a strip hidden before its first
        // layout stays at 0,0, on the primary monitor, so a fullscreen window
        // there would keep it hidden. The panel's monitor is known instead.
        Main.layoutManager.addChrome(this._actor);
        // The panel slides over the clock as it comes back.
        Main.uiGroup.set_child_below_sibling(this._actor, box);

        this._signalsHandler = new Convenience.GlobalSignalsHandler();
        this._signalsHandler.add(
            [box, 'notify::translation-y', this._updateOpacity.bind(this)],
            [box, 'notify::visible', this._updateOpacity.bind(this)],
            // The allocation ignores the slide, so this only fires when the
            // panel is moved or resized.
            [box, 'notify::allocation', this._updateGeometry.bind(this)],
            [global.display, 'in-fullscreen-changed', this._updateVisible.bind(this)],
            [Main.overview, 'showing', this._updateVisible.bind(this)],
            [Main.overview, 'hidden', this._updateVisible.bind(this)],
        );

        this._setSource(panel.statusArea?.dateMenu?._clockDisplay ?? null);
        this._updateGeometry();
        this._updateOpacity();
        this._updateVisible();
    }

    // Hidden over a fullscreen window on the panel's monitor, as the layout
    // manager hides chrome, except in the overview, where windows are not shown.
    _updateVisible() {
        const monitor = Main.layoutManager.monitors[this._monitorIndex];
        this._actor.visible = !(monitor?.inFullscreen && !Main.overview.visible);
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
        // A panel at the bottom of its monitor hides behind the bottom edge.
        const monitor = Main.layoutManager.monitors[this._monitorIndex];
        this._atBottom = !!monitor && y + height / 2 > monitor.y + monitor.height / 2;
        const [, clockHeight] = this._clock.get_preferred_height(width);
        const h = Math.min(Math.round(clockHeight), height) || height;
        this._actor.set_position(x, this._atBottom ? y + height - h : y);
        this._actor.set_size(width, h);
        this._tab.queue_repaint();
        this._updateOffset();
    }

    // The tab: flush with the screen edge, which its corners there curve out
    // into, and rounded off at its other end. Drawn for the top edge and
    // flipped for the bottom one.
    _drawTab(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const f = Math.min(EDGE_FLARE * scale, w / 4, h / 2);
        const r = Math.max(Math.min(h / 2, h - f, w / 2 - f), 0);
        if (this._atBottom) {
            cr.translate(0, h);
            cr.scale(1, -1);
        }
        cr.moveTo(0, 0);
        cr.lineTo(w, 0);
        cr.arcNegative(w, f, f, -Math.PI / 2, Math.PI);
        cr.lineTo(w - f, h - r);
        cr.arc(w - f - r, h - r, r, 0, Math.PI / 2);
        cr.lineTo(f + r, h);
        cr.arc(f + r, h - r, r, Math.PI / 2, Math.PI);
        cr.lineTo(f, f);
        cr.arcNegative(0, f, f, 0, -Math.PI / 2);
        cr.closePath();
        cr.setSourceRGBA(...TAB_RGBA);
        cr.fill();
        cr.$dispose();
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

    // The hidden clock is not reactive, so the pointer reaches the window
    // underneath and no leave event comes: follow the pointer instead.
    _hideUnderPointer() {
        if (this._pointerHidden)
            return;
        this._pointerHidden = true;
        this._pointerId = this._cursorTracker.connect('position-invalidated',
            this._checkPointer.bind(this));
        this._updateOpacity();
    }

    _pointerOnClock() {
        const [px, py] = global.get_pointer();
        const [x, y] = this._clock.get_transformed_position();
        const [width, height] = this._clock.get_transformed_size();
        return px >= x && px < x + width && py >= y && py < y + height;
    }

    // Back on the clock: keep waiting. Off it: reveal once it stays off.
    _checkPointer() {
        if (this._pointerOnClock()) {
            this._cancelReveal();
            return;
        }
        if (this._revealId)
            return;
        this._revealId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            REVEAL_DELAY_MS, () => {
                this._revealId = 0;
                if (!this._pointerOnClock())
                    this._stopHidingUnderPointer();
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelReveal() {
        if (this._revealId) {
            GLib.source_remove(this._revealId);
            this._revealId = 0;
        }
    }

    _disconnectPointer() {
        this._cancelReveal();
        if (this._pointerId) {
            this._cursorTracker.disconnect(this._pointerId);
            this._pointerId = 0;
        }
    }

    _stopHidingUnderPointer() {
        this._disconnectPointer();
        this._pointerHidden = false;
        this._updateOpacity();
    }

    // Opacity only: _updateVisible() owns `visible`.
    _updateOpacity() {
        const box = this._box;
        let hidden;
        if (this._pointerHidden)
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
        // The strip follows the clock's height.
        this._updateGeometry();
    }

    destroy() {
        this._disconnectPointer();
        this._dropSource();
        this._signalsHandler.destroy();
        Main.layoutManager.removeChrome(this._actor);
        this._actor.destroy();
    }
}

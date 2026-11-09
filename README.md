# Hide Top Bar: Multi Monitors

Companion for [Hide Top Bar](https://extensions.gnome.org/extension/545/hide-top-bar/). Runs only while Hide Top Bar is active and uses its settings; Hide Top Bar itself stays unmodified.

- Hides the panels Multi Monitors Bar adds on other monitors by the same rules (intellihide, edge pressure, overview).
- Keeps such a panel's clock on screen at the same spot, without seconds, on a tab that grows out of the screen edge the panel hides behind (its corners there curve outward into the edge). The panel slides over it and away again; intellihide, the overview and fullscreen windows have no effect on it. The only thing that hides it is the pointer being on it (it comes back a second after the pointer leaves). While a window fills the clock's monitor this blocks direct scanout, which would leave the clock unpainted. The text is styled by `.hidetopbar-mm-clock` in `stylesheet.css`; the tab's colour and flare are `TAB_RGBA` and `EDGE_FLARE` in `hiddenClock.js`. With [Liquid Glass (AlessandroTelesca's fork)](https://github.com/AlessandroTelesca/liquid-glass) and its *Glass behind the hidden-panel clock* switch on, the tab is drawn as glass instead.
- Keeps Dash to Dock visible when revealed over a maximized window (blocks direct scanout while it is shown).

Install: copy this folder to `~/.local/share/gnome-shell/extensions/hidetopbar-multimonitor@alessandrot`, log out and in, enable it.

GPL-3.0-or-later; `intellihide.js` and parts of `convenience.js` come from Hide Top Bar.

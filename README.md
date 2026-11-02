# Hide Top Bar: Multi Monitors

Companion for [Hide Top Bar](https://extensions.gnome.org/extension/545/hide-top-bar/). Runs only while Hide Top Bar is active and uses its settings; Hide Top Bar itself stays unmodified.

- Hides the panels Multi Monitors Bar adds on other monitors by the same rules (intellihide, edge pressure, overview).
- While such a panel is hidden, shows its clock at the same spot, on a tab that grows out of the screen edge the panel hid behind (its corners there curve outward into the edge), fading in as the panel slides away, without seconds. It shows only while the panel is hidden, and hides in two cases: while the panel is not hidden, and while the pointer is on it (it comes back a second after the pointer leaves). The text is styled by `.hidetopbar-mm-clock` in `stylesheet.css`; the tab's colour and flare are `TAB_RGBA` and `EDGE_FLARE` in `hiddenClock.js`. With [Liquid Glass (AlessandroTelesca's fork)](https://github.com/AlessandroTelesca/liquid-glass) and its *Glass behind the hidden-panel clock* switch on, the tab is drawn as glass instead.
- Keeps Dash to Dock visible when revealed over a maximized window (blocks direct scanout while it is shown).

Install: copy this folder to `~/.local/share/gnome-shell/extensions/hidetopbar-multimonitor@alessandrot`, log out and in, enable it.

GPL-3.0-or-later; `intellihide.js` and parts of `convenience.js` come from Hide Top Bar.

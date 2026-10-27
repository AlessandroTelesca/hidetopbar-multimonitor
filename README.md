# Hide Top Bar: Multi Monitors

Companion for [Hide Top Bar](https://extensions.gnome.org/extension/545/hide-top-bar/). Runs only while Hide Top Bar is active and uses its settings; Hide Top Bar itself stays unmodified.

- Hides the panels Multi Monitors Bar adds on other monitors by the same rules (intellihide, edge pressure, overview).
- While such a panel is hidden, shows its clock at the same spot, fading in as the panel slides away. Click it to hide it for 30 seconds. Restyle it via `.hidetopbar-mm-clock` in `stylesheet.css`.
- Keeps Dash to Dock visible when revealed over a maximized window (blocks direct scanout while it is shown).

Install: copy this folder to `~/.local/share/gnome-shell/extensions/hidetopbar-multimonitor@alessandrot`, log out and in, enable it.

GPL-3.0-or-later; `intellihide.js` and parts of `convenience.js` come from Hide Top Bar.

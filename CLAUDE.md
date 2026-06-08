# CLAUDE.md — Tach

Lightweight Chromium extension (Manifest V3) that sets a default HTML5 video
playback speed on every site and offers quick manual control.

## Stack
- JavaScript (ES6+), Chrome Extensions API (MV3)
- Storage: chrome.storage.sync (single key: defaultPlaybackSpeed)
- Tests: Jest + jsdom
- No build step — load unpacked at chrome://extensions (load the **`src/`** folder)

## Layout
- **`src/`** — the loadable extension. `manifest.json` sits at `src/`'s root
  (Chrome requires the manifest at the root of the loaded folder). ALL runtime
  files live here. Load `src/` unpacked; `npm run package` zips `src/` (manifest
  at the zip root).
- Repo root holds dev-only tooling: `tests/`, `e2e/`, `docs/`, `create_icons.js`,
  `package-extension.js`, and the configs. These never ship.

## Commands
- Test: `npm test`
- Package: `npm run package` (zips `src/` → `dist/`)
- Icons (dev only): `node create_icons.js` (writes to `src/icons/`)

## Key Files
- src/content.js — core speed logic (injected into all pages)
- src/background.js — service worker (install default, getPlaybackSpeed)
- src/popup/ — action popup UI
- src/options/ — default-speed settings page
- src/manifest.json — MV3 config

## Conventions
- Speed range 0.1x–4.0x. Shared constants (SPEED_MIN/SPEED_MAX,
  DEFAULT_SETTINGS, MAX_PER_SITE_ENTRIES) live ONCE in `src/constants.js` and are
  sourced everywhere — content scripts load it first via manifest
  `content_scripts[].js`, popup/options via `<script src="../constants.js">`,
  Node tests via `require`. Do NOT re-duplicate them (the old per-file copies
  were drift-prone and `const DEFAULT_SETTINGS` in two co-injected content
  scripts collided in the shared isolated world).
- Co-injected content scripts (content.js + content-youtube.js) share ONE global
  lexical scope on YouTube; content-youtube.js is wrapped in an IIFE so it leaks
  no top-level binding. Keep it wrapped.
- CSS design tokens (light/dark/auto `:root` vars + base reset) live ONCE in
  `src/theme.css`, linked BEFORE the page stylesheet on every
  extension page (popup, options). Same single-source rule as `constants.js` —
  do NOT re-declare the token blocks in `popup.css`/`options.css`. Theme + accent
  are applied at runtime via `VSC.applyThemePreference` / `VSC.applyAccentColor`
  on `<html>`; every color is a `var(--token)`. A token defined ONLY in theme
  variants (dark `@media` + `[data-theme]`), not base `:root`, is undefined under
  the default `auto` theme on a light OS — use a hardcoded fallback at every use
  site (`var(--status-success, #1a7f37)`) or it resolves to the wrong color.
- The popup's gear button opens settings WITHOUT duplicating UI: it swaps to a
  `#settingsView` that iframes the standalone options page (`options/options.html`).
  ONE settings implementation backs both the popup view and the full-tab options
  page (still wired as `options_page`). options.js adds `.embedded` to `<html>`
  when framed → compact layout. Note: an explicit `display:` beats the UA
  `[hidden]` rule, so any toggled element needs its own `[hidden]{display:none}`.
- No tracking / no external requests (Chrome Web Store target).

## Docs
- docs/_project-architecture.md, docs/_project-context.md

`.claude/` Domdhi.Agents conventions are active.

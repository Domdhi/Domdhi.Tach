# Changelog

All notable changes to Tach are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). The version in `src/manifest.json`,
`package.json` and `package-lock.json` must match (a test enforces it).

## [1.1.0] — 2026-10-24

Released on the Chrome Web Store (`dist/Tach-v1.1.0.zip`); installed copies auto-update.

### Upgrade notes

Four YouTube settings now **default ON**. Anyone who has never changed them
(an unset setting resolves to its default) will see the new behavior right after
updating; anyone who explicitly turned a setting off keeps it off. Each one can
be switched off under Options → YouTube Cleanup.

| Setting | Key | Default |
|---|---|---|
| Hide live chat | `hideLiveChat` | ON (new) |
| Hide games & extras | `hideExtras` | ON (new) |
| Hide sponsored tiles | `hideFeedAds` | ON (new) |
| Skip YouTube ads | `skipAds` | ON (was OFF) |

"Hide comments" (`hideComments`) stays OFF.

No permissions changed, so the update does not trigger a new-permissions prompt.

### Added
- **Hide live chat** (`hideLiveChat`, FR-23): the live/premiere chat panel is now its
  own toggle, hidden in every mode.
- **Hide games & extras** (`hideExtras`, FR-24): Playables shelves, sidebar entries and
  tiles (matched by their `/playables` link), community-post shelves and inline posts,
  and shelves titled exactly "Breaking news", "Playables" or "Latest YouTube posts".
- **Hide sponsored tiles** (`hideFeedAds`, FR-25): sponsored ad tiles in feeds, search
  results and the watch sidebar (`ytd-ad-slot-renderer`, including the wrapping feed
  item). Separate from video-ad skipping. The feed selector was checked against the
  live YouTube home feed.
- Options page: new "Hide live chat", "Hide games & extras" and "Hide sponsored tiles"
  toggles. `DEFAULT_SETTINGS` is now 13 keys.

### Changed
- **Hide comments** now hides the comments thread only; live chat moved to its own
  toggle (previously one switch hid both).
- **Skip YouTube ads** defaults to ON (was OFF).
- Popup layout: scrolling now lives on `body` with a reserved scrollbar lane whose
  width is measured at runtime (`--sb`), so content is always 268px wide with 16px
  on each side, with or without the settings scrollbar.

### Fixed
- **Dial drag jumping to 4.0x:** dragging the speedometer below the arch's baseline
  (for example past the slow end and down) produced a negative angle that was clamped
  to 0° — the 4.0x end. It now snaps to the nearest end of the arch
  (`gaugeSpeedFromAngle`).
- **Off-center popup:** `scrollbar-gutter: stable both-edges` on the 300px root shifted
  content ~10px right and clipped its right edge, because Chrome sizes the popup window
  to the root width and ignores gutters.
- **Settings view off-center:** the settings scrollbar covered the content's right edge
  (16px left / 6px right). Fixed by the `body` scroll container above.

### Developer
- Project-local `chrome-extensions` and `modern-web-guidance` skills (from
  `GoogleChrome/modern-web-guidance`) in `.claude/skills/` and `.agents/skills/`
  (the latter is what Codex discovers); `skills-lock.json` records source and hashes.
- Project-scoped `chrome-devtools` MCP server in `.mcp.json` (`--categoryExtensions
  --autoConnect`, usage statistics and CrUX lookups off) for installing, reloading and
  inspecting the extension in a running Chrome.
- Docs: Tach is live on the Web Store (several docs still said "planned"); FR-21's
  stale "default OFF" status corrected; update procedure documented; the stale
  popup-width memory (`scrollbar-gutter: both-edges`) corrected.
- Tests: 401 passing (was 391 at the start of this release).

## [1.0.0] — 2026-06-08

First release; submitted to the Chrome Web Store 2026-06-08.

### Added
- Default playback speed applied to every HTML5 video on every site (0.1x–4.0x, with a
  0.01x floor reachable from the +/- buttons), defended against pages that reset it.
- Tachometer popup: draggable dial, throttle slider, +/- steps, editable presets,
  reset, and a REDLINE button that jumps to a configurable overdrive speed.
- Per-site speed memory (capped at 100 sites).
- Global keyboard shortcuts for faster / slower / reset.
- YouTube cleanup: hide Shorts, hide comments (and live chat), hide chat in fullscreen
  (default ON), optional auto-skip of video ads by seeking to the end.
- Copy YouTube transcript to the clipboard, with optional timestamps.
- Options page (also shown inside the popup via the gear): settings, per-site presets,
  presets editor, accent color, light/dark/auto theme.
- Privacy by design: no analytics, no tracking, no external network requests.

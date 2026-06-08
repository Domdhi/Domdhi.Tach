# Architecture: Tach — Universal Video Speed Controller

| Attribute | Value |
|-----------|-------|
| **Version** | 1.0 |
| **Status** | Reverse-Engineered |
| **Author** | Dom |
| **Date** | 2026-06-05 |
| **Source** | Reverse-engineered from codebase (`/onboard`) |

---

## System Overview

Tach is a Chromium browser extension (Manifest V3) that gives users control over HTML5 video playback speed on any website. It injects a content script into every page, detects video elements — including dynamically added ones via a `MutationObserver` — and applies the user's preferred playback speed. An action popup provides quick controls (slider, preset buttons, increment/decrement, reset), and an options page lets the user set a persistent default speed.

The extension follows the standard MV3 topology: a service worker for lifecycle events, a content script for direct DOM manipulation, and `chrome.storage.sync` for cross-device settings persistence. Components communicate via Chrome's message-passing API. There is intentionally no build step — plain ES6+ JavaScript loaded directly.

It is a lightweight, single-purpose utility with no backend, no external network calls, no analytics, and no tracking. The intended distribution target is the **Chrome Web Store (planned — not yet published)**; it currently runs as an unpacked extension in developer mode.

### Architecture Style
Browser Extension — event-driven, message-passing. No build/bundler.

### Key Quality Attributes
| Attribute | Priority | Target |
|-----------|----------|--------|
| Performance | H | Near-zero page-load overhead; instant speed changes |
| Compatibility | H | Works on any site with HTML5 `<video>` elements |
| Simplicity | H | No build step, minimal dependencies, small codebase |
| Privacy | H | No tracking, analytics, or external requests (Web Store requirement) |
| Cross-device sync | M | Speed preference synced via Chrome account |
| Maintainability | M | Plain JavaScript, single storage key |

---

## Tech Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Platform | Chrome Extensions API | Manifest V3 | Required for new Chrome Web Store submissions |
| Language | JavaScript (ES6+) | — | Native browser language; no build step needed |
| Storage | `chrome.storage.sync` | — | Cross-device settings sync, built into Chrome |
| UI | HTML + CSS (custom properties) | — | Popup and options pages; no framework |
| Test | Jest + jest-environment-jsdom | ^30.3.0 | Unit-test core logic with a DOM-like environment |
| Icon tooling | none (pure-JS) | — | Dev-only icon generation (`create_icons.js`) via built-in `zlib` — no dependencies, not shipped |

> There is no backend, database, frontend framework, ORM, or CI/CD pipeline. Sections that would describe those are intentionally omitted as N/A for this project.

---

## Architecture Diagram

```
┌────────────────────────────────────────────────────┐
│                   Chrome Browser                    │
│                                                     │
│   ┌──────────┐      messages       ┌────────────┐   │
│   │  Popup   │ ─── setSpeed ────►  │  Content   │   │
│   │  (UI)    │                     │  Script    │   │
│   └────┬─────┘                     └─────┬──────┘   │
│        │                                 │          │
│        │ read/write              read/write │       │
│        ▼                                 ▼          │
│   ┌──────────────────────────────────────────┐     │
│   │            chrome.storage.sync            │     │
│   │     { defaultPlaybackSpeed: number }      │     │
│   └──────────────────────────────────────────┘     │
│        ▲                                 ▲          │
│        │ read/write           onInstalled│          │
│   ┌────┴─────┐                    ┌───────┴──────┐  │
│   │ Options  │                    │  Background  │  │
│   │  Page    │                    │ (Service     │  │
│   └──────────┘                    │  Worker)     │  │
│                                   └──────────────┘  │
│   content script ──► video.playbackRate            │
└────────────────────────────────────────────────────┘
```

---

## Component Architecture

### Content Script (`content.js`)
- **Responsibility**: Injected into all pages at `document_idle`. Reads the saved speed on init, detects videos via `MutationObserver`, applies playback speed to every HTML5 video, and defends the chosen speed against page overrides via a `ratechange` listener.
- **Technology**: Plain JS, DOM APIs, MutationObserver
- **Dependencies**: `chrome.storage.sync`, `chrome.runtime.onMessage`
- **API Surface**: Handles `setSpeed` and `getSpeed` messages. Speed is clamped to `SPEED_MIN`–`SPEED_MAX` (0.1–4.0). Exports internals under `module.exports` for Jest (guarded by a `typeof module` check, ignored by the browser).

### YouTube Cleanup Content Script (`content-youtube.js`) — Epic 5
- **Responsibility**: A second content script scoped to `*://*.youtube.com/*` (no new permissions). Hides Shorts shelves/links (FR-14) and the comments thread + live/premiere live-chat panel (FR-15) via `hideShorts`/`hideComments` (default OFF); suppresses the chat panel in fullscreen via `hideChatFullscreen` (FR-17, default ON); auto-skips ads by seeking the ad `<video>` to its end via `skipAds` (Integration #4, default OFF). Also extracts the transcript (Epic 6). Isolated from `content.js` so site-specific DOM logic never touches the universal speed controller.
- **Technology**: Plain JS, DOM APIs, MutationObserver
- **Dependencies**: `chrome.storage.sync`, `chrome.storage.onChanged`
- **API Surface**: `hideBySelectors` fail-safe sweep (try/catch per selector and per node — NFR-R2, never throws on a selector miss); `applyCleanup` (hide) + `unhideAll` (revert) are symmetric so a live toggle change takes effect without a reload; MutationObserver (100ms debounce, < NFR-P5 200ms) re-applies across SPA navigation. `display:none !important` defeats YouTube's fullscreen re-show of the live-chat panel. Carries the 4th `DEFAULT_SETTINGS` copy.

### Popup UI (`popup/`)
- **Responsibility**: Action popup with a range slider (0.1–4.0), preset buttons, +/- (0.25 step), reset (1.0x), and a "faster" button. ~300px wide with CSS custom properties and animations. Supports keyboard nav (arrows, R, F).
- **Technology**: HTML/CSS/JS
- **Dependencies**: `chrome.tabs`, `chrome.storage.sync`, `chrome.runtime.getManifest()` (for version display)
- **API Surface**: Sends `setSpeed` to the active tab's content script; reads current speed directly from storage (does not use the `getSpeed` message).

### Options Page (`options/`)
- **Responsibility**: Full-page settings UI to set the default playback speed (validated to 0.1–4.0).
- **Technology**: HTML/JS form
- **Dependencies**: `chrome.storage.sync`
- **API Surface**: Reads/writes `defaultPlaybackSpeed`.

### Service Worker (`background.js`)
- **Responsibility**: Sets the default speed (1.0x) on first install; answers `getPlaybackSpeed` messages; routes global keyboard-shortcut commands to the active tab's content script (`handleCommand`/`COMMAND_MESSAGES`/`commandToMessage`, Story 3.3, ADR-001) — all stepping/clamping/persistence lives in the content script.
- **Technology**: MV3 service worker (non-persistent)
- **Dependencies**: `chrome.runtime.onInstalled`, `chrome.runtime.onMessage`, `chrome.commands.onCommand`, `chrome.storage.sync`, `chrome.tabs`
- **API Surface**: `onInstalled`, `onMessage`, and `commands.onCommand` listeners only — holds no long-lived state.

---

## Data Architecture

### Storage Schema
All settings live in `chrome.storage.sync`. **Current (shipped)** state is a single key; the
roadmap grows this into a settings object as features land (see Future Direction and the PRD Data Model).

**Current:**

| Key | Type | Range | Default | Description |
|-----|------|-------|---------|-------------|
| `defaultPlaybackSpeed` | number | 0.01 – 4.0 | 1.0 | User's preferred playback speed (FR-15: floor 0.01, 0.01 precision; coarse step `SPEED_STEP` 0.1) |

**Planned additions** (introduced by the FR noted; defaults keep behavior unchanged):

| Key | Type | Default | Introduced by | Description |
|-----|------|---------|---------------|-------------|
| `redlineSpeed` | number | `2.0` | REDLINE button | Target speed the popup's `[ REDLINE ]` button jumps to (set in options; steps up the 0.25 grid when already at/above it) |
| `perSiteSpeeds` | object (domain → number) | `{}` | FR-11 (per-site presets) | Per-domain speed overrides; resolution precedence is site → global default. Capped at `MAX_PER_SITE_ENTRIES` (100) per NFR-SC2. **The dial/hotkeys persist a speed change here (only) when the domain is "remembered"; the global default is options-owned** |
| `hideShorts` | boolean | `false` | FR-14 | Hide YouTube Shorts shelves/links |
| `hideComments` | boolean | `false` | FR-15 | Hide the YouTube comments thread AND the live/premiere live-chat panel (persists into fullscreen) |
| `hideChatFullscreen` | boolean | `true` | FR-17 | Suppress the live/premiere chat panel in YouTube FULLSCREEN only (collapses the chat column + nudges the player to re-fit). **Ships ON** — the one cleanup default enabled, by user request. Independent of `hideComments` |
| `skipAds` | boolean | `false` | Integration #4 | Auto-skip YouTube ads by seeking the ad `<video>` to its end (the only viable mechanism — see the 2026-06-06 feasibility spike). Ships OFF (Web Store caution) |
| `theme` | enum (`auto`/`light`/`dark`) | `auto` | FR-13 | Popup theme preference (popup applies via `applyThemePreference`; options "Appearance" selector sets it) |
| `customPresets` | number[] | `[0.5, 0.75, 1.0, 1.25, 1.5, 2.0]` | FR-12 | User-chosen popup preset buttons (fixed-length 6; editable in options, rendered in popup) |
| `accentColor` | string (hex) | `#e8590c` | FR-14 | User-settable UI accent. `applyAccentColor` sets `--primary-color`/`--primary-hover`/`--on-accent` with a WCAG-AA-safe darker fill (or dark-text flip). Baked toolbar PNG does NOT follow this |

> Per ADR-003 the store stays in `sync`; the object is still far within the sync quota. Reads must
> tolerate a missing key (treat as default) for forward/backward compatibility across versions.

#### Canonical settings schema (`DEFAULT_SETTINGS`) — Story 3.1

The defaults map below is the **single source of truth** for the settings shape, and it now lives
in exactly one file: **`constants.js`** (alongside `SPEED_MIN`/`SPEED_MAX`/`MAX_PER_SITE_ENTRIES`).
Every component sources it instead of carrying its own copy: content scripts load `constants.js`
first via the manifest `content_scripts[].js` array, the popup/options pages via
`<script src="../constants.js">`, and Node tests via `require`. This supersedes the earlier
"duplicate verbatim across 4 files" rule — those copies drifted, and `const DEFAULT_SETTINGS` in
two co-injected content scripts collided in YouTube's shared isolated world (silently killing
`content-youtube.js`). See ADR-002 below and `constants.js` for the realm-collision detail.

```js
const DEFAULT_SETTINGS = {
    defaultPlaybackSpeed: 1.0,                          // options-owned baseline
    redlineSpeed: 2.0,                                  // popup [ REDLINE ] target
    perSiteSpeeds: {},                                  // registrable-domain → speed
    customPresets: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],    // popup preset buttons
    hideShorts: false,
    hideComments: false,
    hideChatFullscreen: true,                           // FR-17 — ships ON (fullscreen-only chat hide)
    skipAds: false,                                     // Integration #4 — ad-skip via seek-to-end
    theme: 'auto',                                      // FR-13 — 'auto' | 'light' | 'dark'
    accentColor: '#e8590c',                             // FR-14 — user-settable UI accent (default orange)
};
const SPEED_MIN = 0.01, SPEED_MAX = 4.0, SPEED_STEP = 0.1;  // FR-15 — floor 0.01, coarse step 0.1
const MAX_PER_SITE_ENTRIES = 100;                       // NFR-SC2 cap on perSiteSpeeds growth
```

Canonical access pattern (defined in `content.js`, Story 3.1):
- `resolveSettings(stored)` — pure merge of a stored object over `DEFAULT_SETTINGS`; backward-compatible with the legacy single-key store (no migration, no data loss).
- `getSettings(callback)` — reads the known keys from `chrome.storage.sync` and applies defaults.
- `capPerSiteSpeeds(map)` — prunes `perSiteSpeeds` to `MAX_PER_SITE_ENTRIES`, dropping oldest entries.

### Data Access Pattern
| Component | Reads | Writes | Trigger |
|-----------|-------|--------|---------|
| content.js | Yes | Yes | Page load; `setSpeed` message |
| popup.js | Yes | Yes | Popup open; user speed change |
| options.js | Yes | Yes | Options load; save |
| background.js | Yes | Yes | `getPlaybackSpeed`; first install |

### Data Flow
```
Options Page ──set──► chrome.storage.sync ◄──get── Content Script
                              ▲
Popup ──set──────────────────┘
  │
  └──sendMessage(setSpeed)──► Content Script ──► video.playbackRate
```

---

## Message-Passing API

Communication uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`.

| Message | From | To | Payload | Response |
|---------|------|----|---------|----------|
| `setSpeed` | popup | content script | `{action:'setSpeed', speed:number}` | `{success:boolean, error?}` |
| `getSpeed` | (unused — popup reads storage directly) | content script | `{action:'getSpeed'}` | `{speed:number}` |
| `getPlaybackSpeed` | any | background | `{action:'getPlaybackSpeed'}` | `{speed:number}` |

---

## Architecture Decision Records (ADRs)

> ADRs are marked **Inferred** — reconstructed from the codebase, not recorded at decision time.

### ADR-001: Manifest V3 over V2
- **Status**: Inferred
- **Date**: 2026-06-05
- **Context**: Chrome is deprecating Manifest V2; new Web Store submissions must use V3.
- **Decision**: Use MV3 with a service worker rather than a persistent background page.
- **Alternatives**: MV2 (simpler persistent background, but deprecated / not accepted).
- **Consequences**: Service worker is non-persistent — no long-lived background state; `background.js` stays minimal.

### ADR-002: No Build / Bundler
- **Status**: Inferred
- **Date**: 2026-06-05
- **Context**: Tiny codebase (4 JS files, 2 HTML, 1 CSS), no complex deps shipped.
- **Decision**: Plain ES6+ JavaScript, no transpile/bundle step.
- **Alternatives**: TypeScript + Webpack/Vite (type safety + modules, but disproportionate overhead).
- **Consequences**: Fast edit-reload loop; no type safety; no ES module system. Shared constants are NOT duplicated per file — they live once in `constants.js`, loaded first in every context (manifest `content_scripts` order / `<script>` tag / `require`) and read via a `self.VSC || require('./constants')` shim. `content-youtube.js` is IIFE-wrapped so its top-level bindings don't collide with `content.js` in YouTube's shared content-script realm.

### ADR-003: `chrome.storage.sync` over `chrome.storage.local`
- **Status**: Inferred
- **Date**: 2026-06-05
- **Context**: Users expect their speed preference to follow them across devices.
- **Decision**: Persist `defaultPlaybackSpeed` in sync storage.
- **Alternatives**: `storage.local` (device-only); `localStorage` (per-origin, not shared).
- **Consequences**: Syncs via Chrome account; subject to sync quota (a single number is well within limits).

### ADR-004: Jest + jsdom for unit testing, internals exported behind a module guard
- **Status**: Inferred
- **Date**: 2026-06-05
- **Context**: `content.js` runs init code at load and is a browser global script, not a module.
- **Decision**: Export functions/state via `module.exports` guarded by `typeof module !== 'undefined'`; test with Jest + jsdom and a chrome-mock.
- **Alternatives**: No tests; or full E2E only (slower feedback).
- **Consequences**: Core logic is unit-testable without a browser; the guard keeps the export block inert in the extension.

---

## Cross-Cutting Concerns

### Error Handling
- **Strategy**: try/catch in message handlers; speed values validated/clamped before use.
- **User-facing**: Silent, graceful degradation if the content script is not injected; popup retries a failed `setSpeed` once after 500ms.
- **Internal**: `console.log`/`console.error` only; no external error reporting.

### Configuration
- **Source**: `chrome.storage.sync` (user prefs) + `manifest.json` (extension config).
- **Secrets**: None — no external APIs.
- **Feature Flags**: None.

### Logging
- `console.*` to browser dev tools; unstructured.

---

## Infrastructure & Deployment

No servers, build pipeline, or CI/CD. Deployment is the extension package itself.

- **Today**: loaded unpacked via `chrome://extensions` (Developer mode → Load unpacked).
- **Planned**: Chrome Web Store submission — requires a privacy policy, permissions
  justification (especially the `<all_urls>` host permission and any new `commands` /
  `clipboardWrite` additions), and store-listing assets. Tracked in Phase 7 (Epic 8).
- **Packaging**: zip the extension root (manifest + scripts + `icons/`); no transpile step.

---

## Development Standards

### Project Structure
```
/
├── manifest.json        # Extension config (MV3)
├── background.js        # Service worker
├── content.js           # Content script (injected into pages)
├── content-youtube.js   # YouTube-only content script (cleanup + transcript)
├── constants.js         # Shared JS constants/helpers (single source)
├── theme.css            # Shared CSS design tokens (light/dark/auto + reset)
├── popup/               # Action popup (html/js/css) + embedded settings view
├── options/             # Settings page (html/css/js)
├── icons/               # 16/48/128px icons
├── create_icons.js      # Dev-only icon generator (pure-JS, no deps)
├── package-extension.js # Web Store packager (npm run package → dist/*.zip)
├── privacy-policy.{md,html}  # Privacy policy (source + hostable page)
├── jest.config.js       # Jest (jsdom) config
├── playwright.config.js # Playwright (E2E) config
├── tests/               # Jest specs + chrome mock
├── e2e/                 # Playwright specs (incl. popup-settings)
└── docs/                # Project documentation (incl. store-listing.md)
```

### Coding Conventions
- Plain ES6+ JavaScript, no transpiler/bundler.
- Speed range constants (`SPEED_MIN = 0.01`, `SPEED_MAX = 4.0`), step grids (`SPEED_SLIDER_STEP = 0.05` for +/-, `SPEED_SLIDER_DRAG_STEP = 0.25` for slider drag), `DEFAULT_SETTINGS`, and `MAX_PER_SITE_ENTRIES` live ONCE in `constants.js` and are sourced everywhere — do not re-duplicate them per file.
- Event-driven via Chrome API callbacks. CSS design tokens (light/dark/auto `:root` vars + reset) live ONCE in `theme.css`, linked before `popup.css`/`options.css` — the CSS analog of `constants.js`. Consumers must supply a `var(--token, fallback)` for `--status-*` (not defined in base `:root`).

### Testing Strategy
| Level | Framework | Coverage | What's Tested |
|-------|-----------|----------|---------------|
| Unit | Jest + jsdom | Core logic | content/background/popup/options + manifest commands; speed clamping + slider/drag snap grids, message handlers, settings schema, per-site resolution, hotkey routing, theme/accent helpers (**343 tests** across 10 `tests/*.test.js`) |
| Integration | Jest + jsdom (`tests/message-passing.integration.test.js`) | Popup↔content message boundary | setSpeed/getSpeed round-trip, send-with-retry |
| E2E | Playwright (`playwright.config.js` at repo root) | Real unpacked extension | smoke, popup-preset, options-persist, per-site, global-shortcut, epic07-visual, **popup-settings** (gear→iframe→back) — **7 specs** |

**Test-environment constraints** (promoted from memory — durable gotchas for future test work):
- **jsdom does NOT dispatch `ratechange` on `playbackRate` assignment** (a real browser does). Unit tests for the rate-change defence therefore cannot exercise the self-trigger path — the divergence check (`Math.abs > 0.01`) is what actually prevents the re-apply loop; jsdom-green is not proof the guard works in a browser.
- **E2E is HEADED-only in WSL2**: the MV3 service worker never starts in headless Chromium here, so the extension-id wait times out. Run via WSLg (`npm run e2e`); `HEADLESS=1` fails before any assertion.
- **`chrome.commands` global shortcuts and `chrome.action.openPopup()` are not programmatically dispatchable** in a Playwright persistent context. E2E for hotkeys invokes the real service-worker handler (`handleCommand`) directly; only the OS-keystroke→onCommand binding is the un-automatable seam.

---

## Known Issues & Tech Debt

- **Duplicated speed constants + `DEFAULT_SETTINGS` schema**: 3 byte-identical copies (content/popup/options) kept in sync by hand (ADR-002; see Conventions). Tests assert identity. `getRegistrableDomain` (content) and `getDomainFromUrl` (popup) are also a mirror pair — same eTLD+1 logic, same `< 2` label boundary.
- **Speed-control contract (D2; revised — the default is options-owned)**: the global `defaultPlaybackSpeed` is written ONLY by the options page (plus the service worker on install). A speed change from the popup dial / `+`–`−` or an in-page hotkey applies **live**, and persists ONLY when the current domain has a per-site preset — then it writes `perSiteSpeeds[domain]`. On an un-remembered site the change is live-only and reverts to the resolved default on reload; the user opts into persistence via the popup's "Remember rate for this site" toggle, which captures the current value as a per-site entry. The content `setSpeed` handler and `persistHotkeySpeed` share this path; the popup mirrors it via `buildSpeedWrite` (both return/no-op without a write on an un-remembered site). *(Earlier Stories 3.3/3.8 had these paths fall back to writing the global default — that fallback was removed so the dial/hotkeys never silently overwrite the user's baseline.)*
- **Validate-on-write (resolved D1/D4)**: every speed write path (`persistHotkeySpeed`, popup `buildSpeedWrite`, popup `savePerSiteSpeed`) calls `isValidSpeed` before storing.
- **Per-site coverage**: resolution (site→global), precedence, and the options-page remove round-trip are E2E-covered (`e2e/per-site-speed.spec.js`). The popup "remember this site" toggle's storage logic is unit-covered (`buildSpeedWrite`); the toggle UI itself is not E2E-testable (no `chrome.action.openPopup()` in a Playwright persistent context).
- *(Resolved)* duplicate `onMessage` listeners (Story 0.2), speed-range inconsistency (0.3), version mismatch (0.4), no-E2E-coverage (Epic 2 stood up the Playwright runner + specs).

---

## Future Direction

The original roadmap is **fully shipped** (Epics 0–8). For history:

1. *(Done — Epics 2–5)* Testing/E2E (Playwright runner + specs, integration coverage); keyboard shortcuts + per-site presets; YouTube cleanup (`content-youtube.js`, opt-in toggles).
2. *(Done — Epics 6–7)* Custom presets, dark/light/auto theme + accent color, shared `theme.css`, popup/options redesign, in-popup settings view.
3. *(Done — Epic 5/6)* Transcript copy — scrape the YouTube transcript panel + `clipboardWrite` on click.
4. *(Done — Epic 8)* Web Store readiness — privacy policy + permission justifications, whitelist packager (`npm run package`), store listing. Remaining is **manual submission** (capture screenshots, host the privacy policy, upload `dist/*.zip`).

> Scope broadened from "video speed" to a general video/YouTube utility. `host_permissions: <all_urls>` and the four permissions are justified in `docs/privacy-policy.md` for the Web Store. Post-v1 ideas live in `docs/todo/_feature-ideas.md`.

---

## Related Documents
- PRD: [_project-requirements.md](_project-requirements.md)
- Context: [_project-context.md](_project-context.md)
- Backlog: [todo/_backlog.md](todo/_backlog.md)
- Feature Ideas: [todo/_feature-ideas.md](todo/_feature-ideas.md)

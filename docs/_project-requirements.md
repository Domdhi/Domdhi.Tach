# Product Requirements Document: Tach — Universal Video Speed Controller

| Attribute | Value |
|-----------|-------|
| **Project** | Tach — Universal Video Speed Controller |
| **Version** | 2.0 |
| **Status** | Review |
| **Author** | Larry (Product Strategist) |
| **Date** | 2026-06-05 |
| **Tech Stack** | JavaScript (ES6+) + Chrome Extensions API (Manifest V3) + chrome.storage.sync — no backend, no framework, no build step |

> **This document is the backlog of record.** It consolidates the shipped functionality (carried forward from the original `_prd.md`, marked **Implemented**) with the forward-looking scope (marked **Planned**). Where a requirement is already built, its acceptance criteria describe verified behavior; where it is planned, the criteria define the contract for future work.

---

## Executive Summary

Tach is a Chromium browser extension (Manifest V3) that gives users persistent, universal control over HTML5 video playback speed across every website. Users set a default speed once; the extension applies it automatically to every video they encounter — including videos loaded dynamically by single-page apps — and actively defends that speed against pages that try to reset it. The preference syncs across devices via the user's Chrome account. The product is privacy-first by design: no tracking, no analytics, and zero external network requests. This is both a user promise and a Chrome Web Store differentiator.

The extension serves anyone who watches a meaningful volume of web video and is tired of re-setting speed on every site and every clip — students consuming lectures at 1.5x–2.0x, podcast and content consumers who want one consistent default everywhere, and casual viewers who simply want a "set it and forget it" experience. Today it ships an options page for the persistent default, a popup with a slider, presets, increment/decrement, reset, and faster controls, a content script that applies and protects speed, and cross-device sync.

**Scope expansion.** This version marks a deliberate broadening of the product from a *pure video-speed tool* into a *general video and YouTube utility*. The forward-looking scope adds advanced speed control (global keyboard shortcuts, per-site presets), UI enhancements (custom presets, dark mode), YouTube content cleanup (hide Shorts, hide comments), and transcript copy. This expansion changes the product's center of gravity and carries concrete implications: the storage schema grows beyond a single key, the content script gains site-specific responsibilities, and some features require additional manifest permissions (`commands`, `clipboardWrite`) that must be justified for Chrome Web Store review. Every new permission is treated as a cost to be paid down against the privacy stance, not a free addition.

The intended distribution target is the **Chrome Web Store (planned — not yet published)**; the extension currently runs as an unpacked extension in developer mode.

---

## User Personas

### Persona 1: Alex (Speed Learner)
- **Background**: Graduate student who watches 3+ hours of lecture recordings, tutorials, and educational videos daily across YouTube, Coursera, Udemy, and university LMS portals.
- **Goals**: Consume educational content faster without missing key information; maintain a consistent speed (typically 1.5–2.0x) across all platforms without re-adjusting per site; adjust speed quickly without breaking flow; extract a transcript to skim or study from.
- **Frustrations**: YouTube remembers speed but Coursera/Udemy/Vimeo don't; clicking through menus every time; sites resetting speed on navigation; limited speed options on some platforms (e.g., no 1.75x); having to open the popup just to nudge speed; YouTube's Shorts and comment clutter when studying.
- **Tech Comfort**: High

### Persona 2: Maria (Casual Browser)
- **Background**: Non-technical user who watches a mix of entertainment and informational videos and wants a "set it and forget it" experience.
- **Goals**: Set a preferred default speed once and have it apply everywhere; one-click speed boost for any video; occasionally tweak speed for specific content; a popup that's pleasant to look at, including at night.
- **Frustrations**: Inconsistent playback-speed defaults across sites; doesn't want to learn complex tools; wants something that "just works" and doesn't spy on her.
- **Tech Comfort**: Low / Medium

---

## Functional Requirements

> **Priority legend (MoSCoW):** Must Have / Should Have / Could Have / Won't Have (this version).
> **Status legend:** **Implemented** (shipped and unit-tested) / **Planned** (specified, not yet built).

### Module: Speed Configuration (Options Page)

#### FR-1: Default Speed Setting
- **Priority**: Must Have
- **Status**: Implemented
- **Persona**: Alex, Maria
- **Description**: Users set a default playback speed via the options page. The speed is stored in `chrome.storage.sync` and applied to all future video playback. Range is 0.1x–4.0x.
- **Acceptance Criteria**:
  - Given the user opens the options page, When they select a speed between 0.1x and 4.0x and save, Then the speed is persisted in `chrome.storage.sync` under `defaultPlaybackSpeed`.
  - Given a default speed is saved, When the user navigates to any page with an HTML5 video, Then the video plays at the saved default speed.
  - Given the user enters a value outside 0.1x–4.0x, When they attempt to save, Then the value is rejected/clamped and an error or corrected value is shown — the invalid value is never persisted.

### Module: Content Script (Auto-Apply & Protection)

#### FR-2: Auto-Apply Speed on Page Load
- **Priority**: Must Have
- **Status**: Implemented
- **Persona**: Alex, Maria
- **Description**: The content script automatically applies the saved playback speed to all HTML5 video elements on page load and uses a `MutationObserver` to detect and apply speed to dynamically loaded videos (SPAs, infinite scroll, lazy loading).
- **Acceptance Criteria**:
  - Given a saved speed of 1.5x, When the user navigates to a page with a video, Then the video's `playbackRate` is set to 1.5.
  - Given a page has 3 video elements, When the extension loads, Then all 3 videos have the default speed applied.
  - Given a page dynamically loads a new video element, When the `MutationObserver` detects it, Then the saved speed is applied to the new video within 200ms.
  - Given a SPA navigates to a new view with videos, When the new videos mount, Then they get the speed applied.
- **Notes**: Content script runs on all URLs (matches `<all_urls>` host permission).

#### FR-5: Rate Change Protection
- **Priority**: Should Have
- **Status**: Implemented
- **Persona**: Alex
- **Description**: The content script listens to `ratechange` events on video elements and re-applies the user's preferred speed if the page's own JavaScript tries to override it.
- **Acceptance Criteria**:
  - Given the user has set speed to 2.0x, When a page script sets `video.playbackRate = 1.0`, Then the content script detects the `ratechange` event and resets the rate to 2.0x.
- **Notes**: Can conflict with sites that legitimately change speed (e.g., slow-motion segments). Fine-grained edge-case handling is not currently implemented — see Assumptions.

### Module: Popup UI (Manual Control)

#### FR-3: Manual Speed Control via Popup
- **Priority**: Must Have
- **Status**: Implemented
- **Persona**: Alex, Maria
- **Description**: The popup provides a slider (0.1x–4.0x), preset buttons (0.5x, 0.75x, 1.0x, 1.25x, 1.5x, 2.0x), increment/decrement buttons (±0.25 step), a Reset button (1.0x), and a Faster button. Changes apply to the active tab and persist.
- **Acceptance Criteria**:
  - Given the user clicks the extension icon, When the popup opens, Then it shows the current speed.
  - Given the user changes the slider, When the value commits (mouse release, keyboard arrow, or touch), Then the speed is applied to all videos on the active tab.
  - Given the user clicks a preset (e.g., 1.5x), When the button is clicked, Then the speed is set to 1.5x and saved.
  - Given current speed is 1.0x, When the user clicks +, Then speed increases to 1.25x.
  - Given current speed is at the 0.1x floor, When the user clicks −, Then speed does not decrease below 0.1x.
  - Given any speed is active, When the user clicks Reset, Then speed is set to 1.0x.

#### FR-6: Keyboard Navigation in Popup
- **Priority**: Should Have
- **Status**: Implemented
- **Persona**: Alex
- **Description**: The popup supports keyboard shortcuts while open: Arrow Up/Right to increase speed, Arrow Down/Left to decrease speed, R to reset to 1.0x, F for faster.
- **Acceptance Criteria**:
  - Given the popup is open, When the user presses Arrow Up, Then speed increases by 0.25x.
  - Given the popup is open, When the user presses R, Then speed resets to 1.0x.
  - Given the popup is open, When the user presses F, Then speed increases (Faster).
- **Notes**: Popup-scoped only. System-wide hotkeys that work without opening the popup are a separate requirement — see FR-10.

### Module: Speed Persistence

#### FR-4: Cross-Device Speed Sync
- **Priority**: Must Have
- **Status**: Implemented
- **Persona**: Alex, Maria
- **Description**: All speed changes (from popup or options page) are saved to `chrome.storage.sync`, enabling cross-device synchronization for signed-in Chrome users.
- **Acceptance Criteria**:
  - Given the user sets speed to 1.75x on Device A, When they open Chrome on Device B (same account, sync enabled), Then the speed preference reads 1.75x.
  - Given the user changes speed via the popup, When the change is made, Then `chrome.storage.sync` is updated immediately.

### Module: Background Service

#### FR-7: Install Initialization
- **Priority**: Must Have
- **Status**: Implemented
- **Persona**: Alex, Maria
- **Description**: On first install, set the default speed to 1.0x in storage via the `onInstalled` event.
- **Acceptance Criteria**:
  - Given the extension is freshly installed, When `onInstalled` fires with reason `install`, Then `defaultPlaybackSpeed` is set to 1.0.

### Module: Quality & Testing

#### FR-8: End-to-End Test Coverage
- **Priority**: Should Have
- **Status**: Planned
- **Persona**: (Internal — quality assurance for Alex & Maria)
- **Description**: Activate the existing Playwright configuration (`.playwright/`) and add end-to-end tests covering popup controls, options save/load, and speed application on a real page in a real browser context. Today only `content.js` has 40 Jest unit tests; there is no integration or E2E coverage.
- **Acceptance Criteria**:
  - Given the Playwright config is activated, When the E2E suite runs, Then it launches a Chromium context with the unpacked extension loaded.
  - Given the E2E suite runs, When the popup is opened and a preset is clicked, Then the test asserts the active tab's video `playbackRate` matches the selected preset.
  - Given the E2E suite runs, When a speed is saved on the options page and a new page with a video is loaded, Then the test asserts the video plays at the saved speed.
  - Given the E2E suite runs in CI or locally, When all specs complete, Then a pass/fail result is reported per spec.
- **Notes**: Validates FR-1, FR-2, and FR-3 against a real browser — the highest-leverage quality gap in the project.

#### FR-9: Integration Test Coverage (Message Passing)
- **Priority**: Could Have
- **Status**: Planned
- **Persona**: (Internal — quality assurance)
- **Description**: Add integration tests for the message-passing contract between the popup and the content script (`setSpeed` / `getSpeed`), exercising the boundary that unit tests mock out.
- **Acceptance Criteria**:
  - Given a `setSpeed` message is dispatched from a popup-like context, When the content script receives it, Then it applies the speed and returns `{success: true}`.
  - Given the content script is not injected on the target tab, When a `setSpeed` message is sent, Then the sender handles the failure gracefully (no uncaught error; popup retry behavior preserved).
- **Notes**: Lower priority than E2E because FR-8 partially exercises the same boundary; this fills the seam between unit and full E2E.

### Module: Advanced Speed Control

#### FR-10: Global Keyboard Shortcuts
- **Priority**: Should Have
- **Status**: Planned
- **Persona**: Alex
- **Description**: Allow users to adjust and reset playback speed via browser-level keyboard commands **without opening the popup**, using the Chrome `commands` API. Distinct from FR-6, which only works while the popup is open.
- **Acceptance Criteria**:
  - Given focus is on a page with a playing video, When the user presses the "increase speed" command shortcut, Then the active tab's video speed increases by one step and the new speed persists.
  - Given the user presses the "decrease speed" command shortcut, When a video is present, Then the speed decreases by one step, clamped to 0.1x.
  - Given the user presses the "reset speed" command shortcut, When a video is present, Then the speed resets to 1.0x.
  - Given the user opens `chrome://extensions/shortcuts`, When they view Tach, Then they can see and rebind the extension's commands.
- **Notes**: **Requires adding the `commands` key to `manifest.json`.** Chrome limits suggested key bindings; defaults should avoid common conflicts. See NFR-S5 for Web Store permission justification.

#### FR-11: Per-Site Speed Presets
- **Priority**: Should Have
- **Status**: Planned
- **Persona**: Alex
- **Description**: Remember and automatically apply a different default speed per website domain (e.g., YouTube at 2.0x, a banking site at 1.0x). Falls back to the global `defaultPlaybackSpeed` when no per-site value exists.
- **Acceptance Criteria**:
  - Given the user sets 2.0x on `youtube.com` and enables "remember for this site", When they later return to any `youtube.com` page, Then videos auto-apply 2.0x.
  - Given a per-site preset exists for `youtube.com` but not `vimeo.com`, When the user visits `vimeo.com`, Then the global default speed is applied.
  - Given the user removes a per-site preset, When they revisit that site, Then the global default applies again.
  - Given per-site presets are stored, When the user signs into Chrome on another device, Then the per-site presets sync.
- **Notes**: **Expands the storage schema beyond the single `defaultPlaybackSpeed` key** — introduces a `perSiteSpeeds` map keyed by domain. See Data Model and NFR-SC2 (sync quota).

### Module: UI Enhancements

#### FR-12: Customizable Preset Buttons
- **Priority**: Could Have
- **Status**: Planned
- **Persona**: Alex, Maria
- **Description**: Let users choose which speed presets appear in the popup instead of the fixed default set, so power users can surface 1.75x or 3.0x and casual users can simplify.
- **Acceptance Criteria**:
  - Given the user opens preset configuration, When they add 1.75x and remove 0.5x, Then the popup shows the updated preset set on next open.
  - Given the user has never customized presets, When the popup opens, Then it shows the default set (0.5x, 0.75x, 1.0x, 1.25x, 1.5x, 2.0x).
  - Given custom presets are saved, When Chrome syncs, Then the chosen presets follow the user across devices.
- **Notes**: Adds a `customPresets` key to the storage schema.

#### FR-13: Dark Mode for Popup
- **Priority**: Could Have
- **Status**: Planned
- **Persona**: Maria
- **Description**: Support a dark theme for the popup, either via an explicit toggle or by auto-detecting the system color-scheme preference.
- **Acceptance Criteria**:
  - Given the OS is set to dark mode and auto-detect is enabled, When the popup opens, Then it renders in its dark theme.
  - Given the user sets an explicit theme preference (light/dark/auto), When the popup opens, Then it honors that preference over the system setting.
  - Given a theme is applied, When measured, Then text/background contrast meets WCAG 2.1 AA (4.5:1) in both themes (see NFR-A3).
- **Notes**: Auto-detect can use `prefers-color-scheme`; an explicit toggle adds a `theme` key to storage.

### Module: YouTube Content Cleanup

> This module is the clearest expression of the scope expansion: it takes the product from "control video speed anywhere" into "make YouTube a better place to watch." Both features are **toggleable and default OFF** — Tach must not silently alter a site's appearance.

#### FR-14: Hide YouTube Shorts
- **Priority**: Should Have
- **Status**: Planned
- **Persona**: Alex
- **Description**: Provide a toggle in the options page that hides YouTube Shorts shelves and Shorts links across YouTube (home, subscriptions, search, sidebar). Default OFF.
- **Acceptance Criteria**:
  - Given the "Hide Shorts" toggle is OFF (default), When the user browses YouTube, Then Shorts appear normally.
  - Given the toggle is ON, When the user loads the YouTube home page, Then Shorts shelves and Shorts entry points are hidden.
  - Given the toggle is ON, When YouTube performs SPA navigation (e.g., home → search) and re-renders Shorts, Then the newly rendered Shorts are also hidden (via the same MutationObserver pattern as FR-2).
  - Given the toggle is switched OFF while on a YouTube page, When the user reloads or navigates, Then Shorts are visible again.
- **Notes**: Requires YouTube-specific DOM selectors resilient to SPA navigation and DOM churn. Selectors are fragile by nature — see Assumptions (YouTube DOM volatility). Toggle persisted in `chrome.storage.sync`.

#### FR-15: Hide YouTube Comments
- **Priority**: Should Have
- **Status**: Planned
- **Persona**: Alex
- **Description**: Provide a toggle in the options page that hides the comments section on YouTube watch pages. Default OFF.
- **Acceptance Criteria**:
  - Given the "Hide Comments" toggle is OFF (default), When the user opens a watch page, Then comments display normally.
  - Given the toggle is ON, When the user opens a watch page, Then the comments section is hidden.
  - Given the toggle is ON, When the user navigates between watch pages via YouTube's SPA, Then comments remain hidden on each subsequent page.
  - Given the toggle is OFF, When the user opens a watch page, Then comments render normally without layout artifacts from the extension.
- **Notes**: Same DOM-resilience and persistence considerations as FR-14. Both toggles should live in a YouTube-specific content-script module distinct from the speed logic.

### Module: Transcript Copy

#### FR-16: Copy Video Transcript
- **Priority**: Should Have
- **Status**: Planned
- **Persona**: Alex
- **Description**: Extract a video's transcript (YouTube first) and copy it to the clipboard via a popup or page-action affordance, so users can paste it into notes, an LLM, or a document.
- **Acceptance Criteria**:
  - Given the user is on a YouTube watch page with an available transcript, When they trigger "Copy Transcript", Then the full transcript text is written to the clipboard and a success confirmation is shown.
  - Given the user is on a video with no transcript available, When they trigger "Copy Transcript", Then a clear "No transcript available for this video" message is shown and nothing is copied.
  - Given a transcript is copied, When the user pastes, Then the text is readable plain text with timestamps stripped by default (a future option may toggle timestamp inclusion; default = stripped).
  - Given the user is on a non-YouTube page, When they open the popup, Then the transcript action is hidden or clearly marked unsupported for this site.
- **Notes**: Requires reading YouTube's transcript panel/DOM (or transcript surface) and the **`clipboardWrite` capability**. Transcript availability varies — many videos have none, and auto-generated captions differ from authored ones. See NFR-S5/S6 for Web Store justification and user-action constraint.

### Module: Won't Have (This Version)

#### FR-17: Cross-Browser Ports (Firefox / Safari)
- **Priority**: Won't Have (this version)
- **Status**: Deferred
- **Persona**: Alex, Maria
- **Description**: Porting to Firefox (WebExtensions) and Safari (Safari Web Extensions). Explicitly deferred to keep this version focused on shipping the Chromium feature set and a Web Store submission. Captured here so the decision is visible, not forgotten.
- **Acceptance Criteria**: N/A this version.
- **Notes**: MV3 + `chrome.*` usage is already largely WebExtensions-compatible, lowering future porting cost; revisit after Web Store launch.

#### FR-18: Speed Statistics / "Time Saved" Analytics
- **Priority**: Won't Have (this version)
- **Status**: Deferred
- **Persona**: Alex
- **Description**: Track and display how much time the user has saved by watching at faster speeds. Deferred because any analytics surface risks conflicting with the zero-tracking privacy promise (NFR-S1) and adds storage/computation complexity for marginal core value. If ever pursued, it must be 100% local with no external requests.
- **Acceptance Criteria**: N/A this version.

> **FR-19..FR-22 added 2026-06-07 (reconciliation).** These four requirements were
> shipped ahead of the plan and back-filled here so the inline `FR-NN` tags in `src/`
> resolve. They replace earlier code tags that collided with FR-14/FR-15/FR-17 (see
> `docs/todo/_backlog.md` → Post-reconciliation cleanup). All four are **Implemented**.

#### FR-19: Redline Button (Configurable Overdrive Speed)
- **Priority**: Could Have
- **Status**: Implemented
- **Persona**: Alex
- **Description**: The popup's **[ REDLINE ]** button jumps the active video to a user-configurable overdrive speed (`redlineSpeed`, set in Options, range 0.01x–4.0x, default 2.0x). Clicking REDLINE while already at or above the target steps further up the 0.25x grid.
- **Acceptance Criteria**:
  - Given a saved `redlineSpeed`, When the user clicks REDLINE, Then the active `<video>.playbackRate` jumps to that speed.
  - Given the user is already at/above `redlineSpeed`, When clicking REDLINE again, Then speed steps up by 0.25x (clamped to SPEED_MAX).
- **Settings key**: `redlineSpeed` (number, 0.01–4.0, default 2.0).

#### FR-20: Customizable Accent Color
- **Priority**: Could Have
- **Status**: Implemented
- **Description**: User-settable UI accent color for the popup/options (five preset "gem" swatches plus a custom color input). The chosen color drives `--primary-color`, with a derived hover shade and an automatic WCAG-AA on-accent text color (`VSC.ensureAccentContrast`). Default `#9D4EDD` (Domdhi.OS Deep Amethyst). *(Was tagged FR-14 in code — collided with Hide YouTube Shorts.)*
- **Acceptance Criteria**:
  - Given a saved `accentColor`, When any extension page loads, Then the accent CSS variables reflect it with AA-contrast text on accent fills.
- **Settings key**: `accentColor` (6-digit hex, default `#9D4EDD`).

#### FR-21: Auto-Skip YouTube Ads
- **Priority**: Could Have
- **Status**: Implemented (opt-in, default OFF)
- **Description**: On YouTube, optionally auto-skip ads by seeking the ad `<video>` to its end — the only mechanism that works (maxing `playbackRate` is reset and the skip button rejects synthetic clicks; see the 2026-06-06 feasibility spike). Default OFF given Web Store caution.
- **Acceptance Criteria**:
  - Given `skipAds` ON and an ad is playing, When the ad `<video>` is detected, Then it is seeked to its end.
  - Given `skipAds` toggled OFF on a live page, Then ad polling halts immediately.
- **Settings key**: `skipAds` (boolean, default false).

#### FR-22: Hide Live/Premiere Chat in Fullscreen
- **Priority**: Should Have
- **Status**: Implemented (default ON)
- **Description**: On YouTube, suppress the live/premiere chat panel that auto-appears and persists into FULLSCREEN. Hides the chat *column* (not the frame) and fires a window resize so the `<video>` fills. Windowed chat is never touched. Defaults ON by user request. *(Was tagged FR-17 in code — collided with the deferred Cross-Browser Ports requirement.)*
- **Acceptance Criteria**:
  - Given `hideChatFullscreen` ON, When the player enters fullscreen with chat present, Then the chat column is hidden and the video fills the viewport.
  - Given the toggle OFF, Then chat behaves normally in fullscreen.
- **Settings key**: `hideChatFullscreen` (boolean, default true).

---

## Non-Functional Requirements

### Performance
| ID | Requirement | Target | Priority |
|----|------------|--------|----------|
| NFR-P1 | Minimal impact on page load time | < 50ms added latency | Must Have |
| NFR-P2 | Content script lightweight, no external runtime deps | < 10KB core speed script | Must Have |
| NFR-P3 | MutationObserver must not cause excessive DOM processing | Observe only childList/subtree; < 10ms per batch | Should Have |
| NFR-P4 | Speed application latency after video ready | < 100ms | Must Have |
| NFR-P5 | YouTube cleanup selectors must not stall navigation | Hiding applied within < 200ms of relevant nodes mounting; no visible reflow jank | Should Have |

### Security / Privacy
| ID | Requirement | Standard | Priority |
|----|------------|----------|----------|
| NFR-S1 | No tracking, analytics, or telemetry of any kind | Zero external network requests | Must Have |
| NFR-S2 | No external dependencies or CDN-loaded scripts | All shipped code bundled locally | Must Have |
| NFR-S3 | Minimal permissions in manifest | Only what each shipped feature needs (`storage`, `<all_urls>` host) | Must Have |
| NFR-S4 | Input validation on speed values | Speed clamped to valid range (0.1–4.0) before use | Must Have |
| NFR-S5 | Every new manifest permission justified for Web Store review | `commands` (FR-10) and `clipboardWrite` (FR-16) documented with user-facing rationale; no permission added "just in case" | Must Have |
| NFR-S6 | Clipboard access used only on explicit user action | `clipboardWrite` triggered solely by the user invoking Copy Transcript — never silently | Must Have |

### Compatibility
| ID | Requirement | Target | Priority |
|----|------------|--------|----------|
| NFR-C1 | Compatible with Chromium-based browsers | Chrome 88+, Brave, Edge | Must Have |
| NFR-C2 | Works with all standard HTML5 video elements | Standard `<video>` tag across sites | Must Have |
| NFR-C3 | Manifest V3 compliance | Chrome Extensions MV3 spec | Must Have |
| NFR-C4 | YouTube features tolerate SPA navigation & DOM churn | Re-apply within 200ms of a relevant mutation; on selector miss, no-op with zero uncaught console errors | Should Have |

### Reliability
| ID | Requirement | Target | Priority |
|----|------------|--------|----------|
| NFR-R1 | Graceful degradation when content script not injected | No uncaught errors; popup retries failed `setSpeed` once after 500ms | Must Have |
| NFR-R2 | YouTube selector misses must fail safe | On selector mismatch: zero uncaught console errors AND zero non-target DOM nodes removed/modified — the page renders exactly as it would without the extension | Should Have |

### Scalability (Storage)
| ID | Requirement | Target | Priority |
|----|------------|--------|----------|
| NFR-SC1 | Single-key storage stays well within sync quota | One number, trivially within limits | Must Have |
| NFR-SC2 | Growing schema (per-site presets, toggles, custom presets) stays within `chrome.storage.sync` quota | Total < 100KB and < 8KB per item; prune/cap per-site map if needed | Should Have |

### Accessibility
| ID | Requirement | Standard | Priority |
|----|------------|----------|----------|
| NFR-A1 | Keyboard navigation for all popup controls | Arrows, R, F (WCAG 2.1 AA) | Should Have |
| NFR-A2 | ARIA labels on interactive controls | All buttons and slider labeled (WCAG 2.1 AA) | Should Have |
| NFR-A3 | Sufficient color contrast in popup & options (incl. dark mode) | WCAG 2.1 AA (4.5:1) in both themes | Should Have |

---

## User Flows

### Flow 1: First Install & Default Speed Setup (Implemented)
```
1. User installs Tach (Web Store, planned) or loads unpacked via chrome://extensions.
2. Service worker fires onInstalled, sets defaultPlaybackSpeed = 1.0.
3. User navigates to a page with video — plays at normal speed.
4. User opens Options (right-click icon → Options, or chrome://extensions).
5. Options page loads current value and shows a 0.1x–4.0x selector.
6. User selects a preferred default (e.g., 1.5x) and saves.
7. System writes the speed to chrome.storage.sync.
8. All future page loads auto-apply 1.5x to video elements.
```

### Flow 2: On-the-fly Speed Adjustment via Popup (Implemented)
```
1. User is watching a video and wants to change speed.
2. User clicks the Tach toolbar icon.
3. Popup shows current speed, slider, presets, +/- buttons, Reset, Faster.
4. User adjusts speed via any control (or popup keyboard shortcut).
5. Popup sends setSpeed to the content script via chrome.tabs.sendMessage.
   - If the content script isn't injected: popup retries once after 500ms (NFR-R1).
6. Content script sets playbackRate on all video elements on the page.
7. Speed is saved to chrome.storage.sync.
8. User closes popup; speed persists on this and future pages.
```

### Flow 3: Rate Change Protection (Implemented, Automatic)
```
1. User has set speed to 2.0x.
2. Page JS attempts video.playbackRate = 1.0 (e.g., ad start, chapter change).
3. Content script's ratechange listener fires.
4. It compares the new rate to the user's saved preference.
5. If they differ, it re-applies the user's preferred speed (2.0x).
   - Edge case: legitimate slow-motion segments may be overridden (known limitation).
```

### Flow 4: Global Keyboard Shortcut Speed Change (Planned — FR-10)
```
1. User is on a page with a playing video; popup is closed.
2. User presses the "increase speed" command shortcut.
3. Chrome dispatches the command to the service worker / command handler.
4. Handler resolves the active tab and instructs the content script to step speed up.
5. Content script applies the new speed and persists it.
   - If a per-site preset is active (FR-11): the new value updates the per-site value for this domain.
   - If no video is present: command no-ops silently.
6. User continues watching with no popup interaction.
```

### Flow 5: Per-Site Preset Auto-Apply (Planned — FR-11)
```
1. User sets 2.0x on youtube.com and enables "remember for this site".
2. Extension stores perSiteSpeeds["youtube.com"] = 2.0 in chrome.storage.sync.
3. Later, user opens any youtube.com page.
4. Content script reads storage, finds a per-site value for the current domain.
5. It applies 2.0x (overriding the global default for this site).
   - If no per-site value exists for the domain: fall back to global defaultPlaybackSpeed.
```

### Flow 6: Copy Transcript (Planned — FR-16)
```
1. User is on a YouTube watch page and opens the popup (or page action).
2. User triggers "Copy Transcript".
3. Content script locates the transcript surface in the YouTube DOM.
   - If a transcript exists: extract text, write to clipboard (clipboardWrite), show success.
   - If no transcript exists: show "No transcript available for this video"; copy nothing.
   - If on a non-YouTube site: action is hidden or clearly marked unsupported.
4. User pastes the transcript wherever they need it.
```

### Flow 7: Enable YouTube Cleanup (Planned — FR-14 / FR-15)
```
1. User opens the Options page.
2. User enables "Hide Shorts" and/or "Hide Comments" (both default OFF).
3. Toggles are saved to chrome.storage.sync.
4. User navigates to YouTube.
5. The YouTube content module reads the toggles and hides matching elements.
6. On SPA navigation, the MutationObserver re-applies hiding to newly rendered nodes.
   - If YouTube's DOM has changed and selectors miss: page renders normally; feature no-ops (NFR-R2).
```

---

## Data Model (Conceptual)

The product is migrating from a **single-value** model to a **small settings object**. The expansion is additive and backward-compatible: the global default remains the fallback when no finer-grained value applies.

### Entities
| Entity | Description | Key Attributes |
|--------|------------|----------------|
| UserSettings | Persisted user preferences (singleton per Chrome profile) | `defaultPlaybackSpeed` (number, 0.1–4.0) |
| PerSitePreset | A speed override for one domain (FR-11) | domain (key) → speed (number); collectively the `perSiteSpeeds` map |
| PresetConfig | The set of preset buttons shown in the popup (FR-12) | `customPresets` (array of numbers) |
| YouTubeToggles | Cleanup feature switches (FR-14/15) | `hideShorts` (bool, default false), `hideComments` (bool, default false) |
| ThemePreference | Popup appearance (FR-13) | `theme` ("light" / "dark" / "auto") |

### Storage Schema (Conceptual — `chrome.storage.sync`)
| Key | Type | Range / Shape | Default | Introduced by |
|-----|------|---------------|---------|---------------|
| `defaultPlaybackSpeed` | number | 0.01–4.0 | 1.0 | FR-1 (Implemented) |
| `redlineSpeed` | number | 0.01–4.0 | 2.0 | FR-19 (Implemented) |
| `perSiteSpeeds` | object map | `{ [domain]: number }` (capped at MAX_PER_SITE_ENTRIES) | `{}` | FR-11 (Implemented) |
| `customPresets` | array | exactly 6 numbers within 0.01–4.0 | `[0.5,0.75,1.0,1.25,1.5,2.0]` | FR-12 (Implemented) |
| `hideShorts` | boolean | true/false | false | FR-14 (Implemented) |
| `hideComments` | boolean | true/false | false | FR-15 (Implemented) |
| `hideChatFullscreen` | boolean | true/false | true | FR-22 (Implemented) |
| `skipAds` | boolean | true/false | false | FR-21 (Implemented) |
| `theme` | string | light/dark/auto | auto | FR-13 (Implemented) |
| `accentColor` | string | 6-digit hex | `#9D4EDD` | FR-20 (Implemented) |

### Relationships & Rules
- UserSettings is a singleton; PerSitePreset entries are zero-or-many within it.
- Speed resolution precedence: **per-site preset (if present) → global default**.
- All keys are read by the content script. `defaultPlaybackSpeed` is **options-owned** — written only by the options page and by the service worker on install; the popup dial and in-page hotkeys never write it. A dial/hotkey change persists only as a `perSiteSpeeds[domain]` entry, and only when the site is "remembered" (otherwise it applies live and reverts to the default on reload). Other keys are written by the popup and/or options page.
- All keys are subject to `chrome.storage.sync` quota (NFR-SC2) — `perSiteSpeeds` is the only key with unbounded growth and must be capped/pruned if it approaches limits.

---

## API Surface (Internal Messaging)

Tach has **no external/network API**. The only "API" is internal message passing and storage access.

| Group | Purpose | Key Operations |
|-------|---------|----------------|
| `chrome.storage.sync` | Persist all settings | `get(keys)`, `set({...})` |
| `chrome.runtime.onMessage` / `chrome.tabs.sendMessage` | Popup/background ↔ content script | `setSpeed`, `getSpeed`, `getPlaybackSpeed`, (planned) `copyTranscript`, `applyYouTubeToggles` |
| `chrome.tabs` | Target the active tab for speed/transcript changes | `query({active, currentWindow})`, `sendMessage(tabId, msg)` |
| `chrome.runtime.onInstalled` | Initialize defaults on first install | Listener in background.js |
| `chrome.commands` (Planned — FR-10) | Receive global keyboard shortcuts | `onCommand` listener; requires `commands` manifest key |
| Clipboard (Planned — FR-16) | Write transcript text | Clipboard write on explicit user action; requires `clipboardWrite` |

---

## Security Requirements

- **Authentication**: None — browser extension, no user accounts.
- **Authorization**: Chrome extension permission model declared in `manifest.json`. Current: `storage` + `<all_urls>` host permission. Planned additions: `commands` (FR-10), `clipboardWrite` (FR-16) — each must carry a Web Store justification (NFR-S5).
- **Data Protection**: No PII collected. Only user-chosen settings are stored, locally and via Chrome sync. No data leaves the user's Chrome account.
- **Audit**: None server-side (no server). Local `console.*` logging only; unstructured.
- **Compliance**: Chrome Web Store Developer Program Policies. The privacy-first stance (zero tracking, no external requests, minimal permissions) is both a policy fit and a product differentiator — it must be preserved as features are added.

---

## Assumptions & Dependencies

### Assumptions
- Target browsers support Manifest V3 (Chrome 88+, Edge 88+, Brave).
- Videos are standard HTML5 `<video>` elements (not Flash or DRM-wrapped players that block `playbackRate`).
- `chrome.storage.sync` is available; cross-device sync requires Chrome sign-in but the extension works locally without it.
- Most video sites do not implement aggressive countermeasures against `playbackRate` modification; FR-5's protection may conflict with sites that legitimately vary speed.
- **YouTube's DOM is volatile.** FR-14/15/16 depend on YouTube-specific selectors and the transcript surface, which YouTube changes without notice. These features must fail safe (NFR-R2) and will require ongoing selector maintenance — an accepted, recurring cost, not a one-time build.
- Transcript availability varies per video; some videos (especially non-YouTube) have none.
- Adding `commands` and `clipboardWrite` will not jeopardize Web Store approval **provided** each is justified and the privacy stance holds (NFR-S5).

### Dependencies
- Chrome Extension APIs (Manifest V3): `storage.sync`, `runtime`, `tabs`, `onInstalled`, and (planned) `commands` + clipboard.
- HTML5 Video API (`playbackRate`).
- Playwright (`.playwright/` config) for FR-8 E2E; Jest + jsdom for existing unit tests.
- No runtime or build dependencies. Icons are generated by `create_icons.js`, a **dev-only**, dependency-free Node script (built-in `zlib`); not shipped at runtime.
- No external runtime libraries, network APIs, or services.

---

## Success Criteria

| Criteria | Target | Measurement |
|----------|--------|-------------|
| Speed applied to videos on page load | 100% of standard HTML5 videos | E2E (FR-8) across top video sites |
| Speed persists across navigation & restart | Speed maintained in storage | Automated test (Playwright) + manual restart check |
| No page-load performance regression | < 50ms added latency (NFR-P1) | Chrome DevTools profiling |
| Rate-change protection works | User speed re-applied < 100ms after override | Manual testing on sites that reset playbackRate |
| Popup controls fully functional | All buttons, slider, presets, shortcuts work | E2E + manual |
| Global shortcuts work without popup (FR-10) | Speed changes via hotkey on a video page | E2E / manual |
| Per-site presets resolve correctly (FR-11) | Correct precedence: site → global | E2E with two domains |
| YouTube cleanup fails safe (FR-14/15) | Page never breaks when selectors miss | Manual + regression check after YouTube updates |
| Transcript copy handles "no transcript" | Clear message, nothing copied | Manual on a no-transcript video |
| Privacy stance preserved | Zero external network requests | Network panel inspection during a full session |
| Web Store readiness | Submission accepted; permissions justified | Web Store review outcome |

---

## Glossary

| Term | Definition |
|------|-----------|
| playbackRate | HTML5 Video API property controlling playback speed (1.0 = normal). |
| MutationObserver | Web API that watches DOM changes; used to detect dynamically added videos and re-apply YouTube cleanup. |
| chrome.storage.sync | Chrome storage API that syncs data across devices when the user is signed into Chrome. |
| Content Script | Extension script running in the context of web pages, with access to the page DOM. |
| Service Worker | Non-persistent background script in Manifest V3 (replaces MV2 persistent background pages). |
| Manifest V3 | Current Chrome Extensions platform version; required for new Web Store submissions. |
| commands API | Chrome API for registering browser-level keyboard shortcuts that work without opening the popup. |
| clipboardWrite | Capability allowing the extension to write text to the system clipboard. |
| Per-site preset | A speed override stored per domain that takes precedence over the global default. |
| SPA navigation | Single-page-app view changes without a full page reload (e.g., YouTube), which re-render the DOM. |
| Fail safe | A feature that, on selector/match failure, silently no-ops and leaves the page intact. |

---

## Related Documents
- Project Brief: [_project-brief.md](_project-brief.md)
- Architecture: [_project-architecture.md](_project-architecture.md)
- Feature Ideas: [todo/_feature-ideas.md](todo/_feature-ideas.md)
- Backlog: [todo/_backlog.md](todo/_backlog.md)
- Project Context: [_project-context.md](_project-context.md)

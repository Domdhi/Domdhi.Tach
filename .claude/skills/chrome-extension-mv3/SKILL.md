---
name: chrome-extension-mv3
description: "Use WHEN writing or reviewing Manifest V3 Chrome-extension code — content scripts, service worker, chrome.storage, manifest/permissions, or YouTube/page DOM manipulation. Triggers: MV3, manifest, content script, service worker, chrome.storage, isolated world, content-youtube, popup, options, permissions, YouTube DOM"
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [chrome-extension, mv3, content-script, service-worker, storage, youtube]
user-invocable: false
allowed-tools: Read Grep Glob Bash
---

# Chrome Extension (Manifest V3)

The project's highest-risk surface. These rules are hard-won (each cites the bug or spike that
established it); violating them produces silent failures that pass jsdom tests but break in a real
browser. This skill consolidates what was scattered across CLAUDE.md, ADR-002/003, and the
constraint memories.

## Content-script realm isolation (the silent killer)

All content scripts the SAME extension injects into ONE frame run in ONE isolated world that shares
a SINGLE top-level lexical scope. On a YouTube page `content.js` and `content-youtube.js` co-inject.

- A bare top-level `const`/`let`/`class` declared in two co-injected files (or injected twice via
  two matching `content_scripts` entries) throws **"Identifier 'X' has already been declared"**,
  which aborts the WHOLE second script silently. This is what once killed `content-youtube.js`
  entirely (YouTube cleanup + transcript did nothing). [mv3-coinjected-content-scripts-share-lexical-scope]
- **Rule:** wrap every co-injected content script body in an IIFE so it leaks no top-level binding.
  Keep `content-youtube.js` wrapped.
- Shared values (`SPEED_MIN`/`SPEED_MAX`, `DEFAULT_SETTINGS`, `MAX_PER_SITE_ENTRIES`) live ONCE in
  `constants.js`, which sets `self.VSC` idempotently (`self.VSC = self.VSC || VSC`) and is itself
  IIFE-wrapped — so being injected twice on YouTube is harmless. Source it everywhere; never
  re-declare a copy. constants.js is listed FIRST in each manifest `content_scripts[].js` array.

## chrome.storage.sync

- **Non-atomic read-modify-write.** `chrome.storage.sync` has no atomic update. Every write that
  changes ONE key inside the multi-key store (`perSiteSpeeds`, `defaultPlaybackSpeed`, a toggle)
  must read the current value, modify a copy, and write back — never blind-set a key computed from a
  stale read. [storage-sync-nonatomic-read-modify-write]
- **Single-source schema (ADR-002/003).** `DEFAULT_SETTINGS` (10 keys: `defaultPlaybackSpeed`,
  `redlineSpeed`, `perSiteSpeeds`, `customPresets`, `hideShorts`, `hideComments`,
  `hideChatFullscreen`, `skipAds`, `theme`, `accentColor`) lives once in `constants.js`. The
  per-file `resolveSettings` copies (content.js, content-youtube.js) must list the SAME keys —
  adding a setting means updating BOTH copies. Enforced by `tests/constants.test.js` →
  "Schema-parity" (asserts each `resolveSettings({})` returns a defined value for every
  `Object.keys(DEFAULT_SETTINGS)` key); a missing key — e.g. the `redlineSpeed` gap caught in the
  2026-06-07 sweep — fails that test. Reads must tolerate a missing key (treat as the default) for
  cross-version compat.
- **Validate on write, not only on read.** Any function that writes a speed to storage MUST call
  `isValidSpeed` (range, finite) BEFORE storing — storage outlives the writing call, so validate-on-
  read is insufficient. [validate-speed-on-write-not-only-on-read]

## Fail-safe DOM (NFR-R2)

Page DOM (especially YouTube's) changes without notice. Every selector query / event handler must
NO-OP on bad/missing/hostile DOM and NEVER throw out of the script. Wrap each query in try/catch so
one bad selector can't abort the rest. jsdom-green ≠ works-in-browser (e.g. jsdom does not dispatch
`ratechange` on `playbackRate` assignment; `<video>.duration` is read-only/NaN — test such logic via
duck-typed fake roots).

## Scope a DOM mutation to its matched container

After confirming a container exists via `querySelector`, scope EVERY subsequent query to THAT
element (`container.querySelector(...)`) — never re-query from `document`. A `document.querySelector`
after a container-presence check is a multi-element bug waiting for a second matching element to
surface it (sweep M1: the ad-skipper seeked the wrong `<video>` on multi-video pages).
[scope-dom-mutation-to-container]

## Reversible state must be symmetric — on both paths

- A handler that applies reversible state (hide elements, add a class, inject CSS, attach a listener)
  via `storage.onChanged` MUST also REVERT it when toggled off — without a reload.
  [symmetric-live-handler-rule]
- A toggle whose visible effect depends on a SIDE-EFFECT (resize nudge, class removal, style recalc)
  must fire that side-effect on BOTH the state-transition path (e.g. `fullscreenchange`) AND the
  live-toggle path (e.g. `storage.onChanged`). Wiring it to only one leaves a visible defect when the
  user toggles while already in the managed state (sweep M2). [fullscreen-css-toggle-nudge-both-paths]
- Test the transition (OFF→ON→OFF and mid-state toggle), not just steady state.
  [test-the-transition-not-steady-state]

## YouTube trusted-gesture wall

YouTube gates three capabilities behind a TRUSTED (`isTrusted === true`) user gesture, which a
content script CANNOT forge: **autoplay/`play()`**, **fullscreen request**, and the **skip-ad
button**. The window must also be FOCUSED for media to play (backgrounded tabs suspend). Don't try to
drive these with synthetic clicks or `playbackRate` tricks — manipulate state directly instead
(e.g. to skip an ad, seek `video.currentTime = duration`, NOT click `.ytp-skip-ad-button`).
[youtube-trusted-gesture-wall] · spike: docs/.output/investigations/2026-06-06-ad-skipper-feasibility-spike.md

## Service worker (background)

Ephemeral, event-driven, NO DOM access. Wakes on events, may be killed between them — keep no
in-memory state that must persist (use storage). Communicates with content scripts/popup via
`chrome.runtime` message passing; read `chrome.runtime.lastError` in send callbacks to swallow
"no receiving end" when no content script is listening.

## Privacy / Web Store

No tracking, no external network requests (Chrome Web Store target). New capabilities need a
manifest permission AND a privacy justification at launch. Pure-DOM features (the ad-skipper) need no
new permissions — prefer them over network-level approaches (MV3 weakened `declarativeNetRequest`).

## Testing

Jest + jsdom for units (`tests/*.test.js`, `chrome-mock.js` for the chrome API — note it has NO
`storage.onChanged`, so listener wiring is tested by exercising the mechanism functions directly).
Playwright for e2e against the unpacked extension. See the `qa-engineer` skill for the mandatory
adjacent-case matrix (multi-element scope + reversible-state transitions).

**To drive or screenshot the extension's OWN popup/options UI, use Playwright — NOT the
claude-in-chrome MCP.** The MCP is sandboxed out of other extensions' `chrome-extension://`
origins: `read_page`/`javascript_tool`/screenshot all fail with "Cannot access a
chrome-extension:// URL of different extension" (ordinary pages like YouTube are fine; `file://`
also gets mangled — navigate prepends `https://`). Playwright loads the unpacked extension via
`--load-extension` and drives `chrome-extension://<id>/` pages with real `chrome.storage`. Run
headed — the MV3 service worker does not start headless in WSL2.
[claude-in-chrome-cannot-access-other-extension-pages] [store-screenshots-via-playwright-not-mcp]

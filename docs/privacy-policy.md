# Tach — Privacy Policy

**Effective date:** 2026-06-06
**Last updated:** 2026-06-06

Tach is a lightweight browser extension that sets a default HTML5 video
playback speed and gives you quick manual control. Your privacy is the default,
not a setting.

## The short version

**Tach does not collect, store, transmit, sell, or share any personal data.**

- **No tracking.** No analytics, no telemetry, no usage metrics.
- **No external requests.** The extension never contacts the developer or any
  third-party server. It has no backend.
- **No ads, no remote code.** Nothing is downloaded or executed from a remote
  source after install.

## What the extension stores (and where)

Tach saves only your **settings**, using the browser's own
`chrome.storage.sync`:

- Default playback speed
- Per-site speed presets (e.g. a remembered speed for `youtube.com`)
- Your six custom quick-access preset speeds
- Theme preference (light / dark / auto) and accent color
- YouTube cleanup toggles (hide Shorts, hide comments/live chat, hide chat in
  fullscreen, skip ads)
- "Include timestamps" preference for the transcript copy

This data lives in your browser and is synced **by your browser** to your own
signed-in account (e.g. Chrome/Brave sync). It is **never** sent to the
developer or anyone else. Uninstalling the extension removes it.

## Permissions and why each is needed

| Permission | Why Tach requests it |
|------------|--------------------------|
| `storage` | Save your settings (above) and let the browser sync them across your signed-in browsers. |
| `clipboardWrite` | Copy a YouTube video's transcript to your clipboard — **only** when you click the "Copy Transcript" button. |
| Host access (`<all_urls>`) | Run the speed-control content script on pages that contain video, on any site you visit. Tach only reads and sets the playback rate of HTML5 `<video>` elements — it does **not** read page content, form input, passwords, or browsing history, and it sends nothing anywhere. |
| `commands` | Register the optional keyboard shortcuts (increase / decrease / reset speed). This is a manifest declaration, not a data-access permission. |

## The YouTube transcript feature

When — and only when — you click **Copy Transcript** on a YouTube watch page,
Tach reads the transcript that YouTube already shows in the page and writes
it to your clipboard. The transcript is not uploaded, logged, or transmitted
anywhere; it goes straight to your clipboard for you to paste.

## What Tach does NOT do

- Does not collect personal or sensitive information
- Does not track your browsing or build a profile
- Does not use analytics or telemetry of any kind
- Does not make network requests to any server
- Does not sell or share data with third parties
- Does not inject ads or remote code

## Changes to this policy

If this policy ever changes, the updated version will be published here with a
new "Last updated" date. Material changes will be reflected in the extension's
store listing.

## Contact

Questions about this policy or the extension's privacy practices:
**dom@domdhi.com**

<!--
  SUBMISSION NOTE (remove before publishing): the Chrome Web Store listing
  requires this policy hosted at a public URL (e.g. GitHub Pages or the repo's
  rendered Markdown) — the URL goes in the Developer Dashboard's "Privacy" tab.
  The text here is the source of truth. (Contact email above is set.)
-->

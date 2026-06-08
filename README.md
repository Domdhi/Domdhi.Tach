# Tach

**A tachometer for video.** Tach is a lightweight Chromium extension (Manifest V3)
that sets a default HTML5 video playback speed on every site and gives you quick
manual control — with a tachometer-style gauge, per-site speed memory, and
optional YouTube cleanup. Free, private, and open source.

> Part of the `Domdhi.*` family · Media domain · Domdhi.OS design system.

## ✨ Features

- **Default speed everywhere** — set it once (0.1×–4.0×); it applies to every
  HTML5 video automatically, no player menu needed.
- **Quick manual control** — a tachometer gauge with a needle that redlines past
  1×, a throttle slider, +/− steps, and editable one-click presets.
- **Per-site memory** — remember a different speed per domain (YouTube vs. your
  lecture site); it sticks for that site.
- **Keyboard shortcuts** — speed up / slow down / reset without opening the popup.
- **YouTube cleanup (optional)** — hide Shorts, hide comments/live chat, keep chat
  out of fullscreen, skip ads (by seeking past them), and copy the transcript.
- **Themeable** — light / dark / auto, plus a custom accent color.
- **Private by design** — no tracking, no analytics, no external network requests.

## 🔒 Privacy & Open Source

Tach is **MIT-licensed** (see [LICENSE](LICENSE)) and makes a hard promise: it
sends **nothing**, anywhere. That claim is **verifiable**, not just stated:

- **No network code.** There are no `fetch`, `XMLHttpRequest`, or remote-script
  calls to any external origin anywhere in `src/`. Grep it:
  ```bash
  grep -rn "fetch\|XMLHttpRequest\|http://\|https://" src/   # only same-page DOM + domdhi.com link
  ```
- **No remote host permissions for data.** `src/manifest.json` requests
  `<all_urls>` solely so the content script can read and set the `playbackRate`
  of `<video>` elements on whatever page you're watching. It does **not** read
  page content, form input, or history. The only other permissions are `storage`
  (your settings) and `clipboardWrite` (the Copy Transcript button).
- **Your settings stay yours.** They live in `chrome.storage.sync` and sync via
  *your* browser account — never to us. See [docs/privacy-policy.md](docs/privacy-policy.md).

**Branding is reserved.** The MIT license covers the code. The names *Tach* /
*Domdhi.Tach* / *Domdhi* and the Domdhi.OS visual identity are **not** licensed —
forks must rebrand.

## 🚀 Installation (load unpacked)

1. Clone this repository.
2. Open Chrome / Brave / Edge → `chrome://extensions/`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the **`src/`** folder — the manifest lives
   at `src/`'s root, so you must load `src/`, not the repo root.
5. Pin Tach to your toolbar.

## 🎮 Usage

- **Set your default:** open the popup → gear icon → *Default Playback Speed*, or
  right-click the icon → *Options*.
- **Adjust on the fly:** open the popup → drag the throttle slider, tap a preset,
  or use +/−. Past 1× the gauge needle enters the redline ("overdrive").
- **Per-site:** flip *Remember rate for this site* to pin the current speed to
  that domain.

## 🏗️ Layout

```
/
├── src/                    # The loadable extension (load THIS unpacked)
│   ├── manifest.json       # MV3 config (must sit at src/ root)
│   ├── content.js          # Core video detection + speed control
│   ├── content-youtube.js  # YouTube-specific behaviors (IIFE-wrapped)
│   ├── background.js       # Service worker
│   ├── constants.js        # Shared constants / settings schema (single source)
│   ├── theme.css           # Shared Domdhi.OS design tokens
│   ├── popup/              # Action popup UI (the tachometer)
│   ├── options/            # Settings page (also embedded in the popup)
│   └── icons/              # Extension icons
├── tests/                  # Jest unit tests
├── e2e/                    # Playwright end-to-end tests
├── docs/                   # Design specs, store listing, privacy policy
└── package-extension.js    # Builds a Web Store zip from src/
```

## 🛠️ Development

| Task | Command |
|------|---------|
| Run unit tests | `npm test` |
| Run e2e tests | `npm run e2e` |
| Package for the Web Store | `npm run package` (zips `src/` → `dist/`) |
| Regenerate icons (dev only) | `node create_icons.js` |

No build step — it's vanilla HTML/CSS/JS. Load `src/` unpacked and reload the
extension to see changes.

## 📜 License

[MIT](LICENSE) — code only. The *Tach* / *Domdhi* names and Domdhi.OS branding are
reserved; forks must use a different name and identity.

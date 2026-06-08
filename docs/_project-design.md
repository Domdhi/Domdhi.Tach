# Tach — Design System (Domdhi.OS adoption)

| Attribute | Value |
|-----------|-------|
| **Project** | Tach — Universal Video Speed Controller |
| **Design system** | **Domdhi.OS** — Neobrutalist Synthwave ("tactical telemetry meets personal enterprise") |
| **Domain** | **Media** — Tach is the video tool in the Domdhi.OS taxonomy |
| **Shipped default** | **Deep Amethyst `#9D4EDD`** (System gem) — owner's reserved default, **deliberately NOT in the picker**. The five public gems are selectable; amethyst is reachable only via the custom color input. |
| **Date** | 2026-06-07 |
| **Status** | Implemented (commit `8b4d1b6`) |

> This supersedes the prior June-5 scoped doc (which preserved a blue `#4a6bff`
> rounded-card aesthetic and explicitly disclaimed a rebrand). Tach now
> **adopts the Domdhi.OS design system**. The canonical reference is vendored at
> [`docs/design/domdhi-os/`](design/domdhi-os/) (README, `colors_and_type.css`,
> SKILL.md, component previews, pentagon emblem) — that bundle is the source of
> truth; this doc records Tach's *adoption decisions* and reconciliations.

---

## 1. Identity

Tach reads as a **terminal, not a website**: obsidian void, neon gem accents,
zero radius, hard offset shadows, CRT glow, mono telemetry. It is a member of the
Domdhi.OS branded house and occupies the **Media** domain (Electric Violet).

The six domain gems (never desaturate — `#00FF9F`, not `#10B981`):

| Domain | Color | Hex | Role in Tach |
|--------|-------|-----|------------------|
| Media | Electric Violet | `#BF40FF` | Tach's nominal domain; top public swatch |
| Tech | Signal Cyan | `#00F0FF` | selectable accent |
| Finance | Cyber Emerald | `#00FF9F` | selectable accent + success status |
| Freedom | Exit Amber | `#FFB000` | selectable accent |
| Fitness | Arterial Rose | `#FF0055` | selectable accent + **destructive/error** |
| System | Deep Amethyst | `#9D4EDD` | **Shipped default — owner's reserved, NOT a swatch** |

---

## 2. Adoption decisions (and reconciliations)

Tach is a Chrome MV3 extension, so two DS rules were adapted — decided with the user:

| DS rule | Tach reconciliation | Why |
|---------|-------------------------|-----|
| **Dark-mode only** ("there is no light toggle") | **Kept light/dark/auto.** Dark = the faithful terminal; **light = a brutalist-light variant** (warm paper `#f4f3ee`, hard black `#020202` borders + shadows) that the DS does not specify. | The extension already shipped a theme selector users rely on; user chose to keep it. |
| **Single signature would "collapse the multi-accent identity"** | The picker exposes **five public gems** (violet/cyan/emerald/amber/rose); the multi-accent palette lives on as user choice. | A single product owns a domain color; the OS keeps multi-accent. |
| Default accent | Ships as **System / Deep Amethyst `#9D4EDD`** and is **removed from the swatch grid** (reachable only via the custom color input). | Owner's reserved signature — a deliberate "secret" flourish; users get amethyst out-of-box but pick from the five gems thereafter. |
| **Destructive color** | Moved delete/cancel/error from the old `#cf222e` to **Rose `#FF0055`** (Fitness gem). | Keeps a gem palette AND stays distinct from the violet primary (red-as-primary would collide with destructive). |
| **Fonts via Google/Fontshare CDN** | **System-stack fallbacks** (`Space Grotesk → system-ui`, `JetBrains Mono → Menlo`). | Extension CSP forbids external requests (no tracking, Web Store target). *Follow-up: vendor woff2 for pixel fidelity.* |

---

## 3. Tokens (`theme.css`)

`theme.css` mirrors the canonical `colors_and_type.css` but keeps Tach's
existing **semantic token names** so the token-driven `popup.css`/`options.css`
inherit the new look without rewiring. Accent glow + brutal-shadow tints are
**derived from `--primary-color` via `color-mix()`**, so any user-chosen gem
auto-tints its own glow and hard shadow.

| Token | Dark (terminal) | Light (brutalist-light) |
|-------|-----------------|--------------------------|
| `--background` | `#020202` obsidian void | `#f4f3ee` warm paper |
| `--surface` | `#0a0a0a` drawer | `#ffffff` |
| `--border` | `rgba(255,255,255,0.16)` | `#020202` hard black |
| `--text-primary` | `#ededed` phosphor | `#020202` |
| `--text-secondary` | `#71717a` zinc-500 | `#52525b` zinc-600 |
| `--primary-color` | `#9D4EDD` default (inline accent overrides) | `#9D4EDD` |
| `--on-accent` | `#020202` (void text on neon fill) | `#020202` |
| `--shadow` | `4px 4px 0 0 var(--accent-shadow)` | `4px 4px 0 0 rgba(2,2,2,.9)` |
| `--status-success` | `#00FF9F` emerald | `#047857` |
| `--status-error` | `#FF0055` rose | `#c01048` |
| `--border-radius` | `0` (everywhere) | `0` |
| `--transition` | `all 150ms cubic-bezier(0.16,1,0.3,1)` (expo-out) | same |

Derived accent tints: `--accent-glow` (55%), `--accent-glow-strong` (90%),
`--accent-glow-alpha` (15%), `--accent-shadow` (45%), `--accent-shadow-hover` (60%).

Type tiers: `--font-brand` (Clash Display → Space Grotesk), `--font-header`
(Space Grotesk, all UI), `--font-mono` (JetBrains Mono — all numbers, metrics,
labels, buttons).

---

## 4. Component patterns (as implemented)

- **Cards** — `1px solid --border` + brutal `--shadow`, `0` radius. Title is
  uppercase Space Grotesk with a mono `// ` accent prefix (the section-label motif).
- **Speed value** — JetBrains Mono, accent fill, `text-shadow: 0 0 18px --accent-glow`
  (CRT glow on the telemetry number).
- **Primary button** (Faster / Save) — accent fill + `--on-accent` text + brutal
  hard shadow (`2px`/`4px` popup, `4px`/`6px` options); hover lifts into the shadow
  with an accent glow halo; press collapses the shadow. Mono uppercase.
- **Outline buttons** (Reset / +- / reset-presets) — border adopts the accent +
  text-glow on hover, `-1px` lift. Mono uppercase.
- **Presets** — mono, `0` radius; active = accent fill + brutal shadow + glow.
- **Toggles / swatches** — square (zero radius). Accent swatches are the six gems,
  evenly spread, hard-shadow hover.
- **Canvas** — 24×24 dot-grid (`color-mix(--text-primary 7%)`) on popup + options body.
- **Per-site rows** — edit (pencil) / delete (trash) icon buttons; delete/cancel
  go Rose on hover.

### Not yet implemented (follow-ups)
- Vendored woff2 fonts (currently system fallback).
- Scanlines + CRT vignette overlays (DS "always-on"; omitted in the popup for now
  to keep the 300px surface calm — candidate for the options page).
- Pentagon emblem as the brand mark (toolbar icon stays the simplified play-glyph
  for 16px legibility; pentagon belongs on the 128px store icon / marketing).

---

## 5. Toolbar icon

- **Toolbar PNGs + dynamic SW icon:** obsidian void `#020202` square (zero radius) +
  Deep Amethyst `#9D4EDD` play-triangle + motion-bars glyph (the shipped default).
  Generated by `create_icons.js`;
  the service worker (`background.js`) repaints it in the user's chosen gem at
  runtime (`chrome.action.setIcon` via OffscreenCanvas).
- **Store / marketing (future):** the full Domdhi pentagon-emblem treatment
  (void circle, six gem nodes, hex orbit, glow) with the play glyph — reserved for
  the 128px store icon, not the 16px toolbar.

---

## Related Documents
- Vendored DS reference: [design/domdhi-os/](design/domdhi-os/) — README, tokens, SKILL, previews
- Brand skill: `.claude/skills/brand-guidelines/SKILL.md`
- Requirements: [_project-requirements.md](_project-requirements.md)
- Architecture: [_project-architecture.md](_project-architecture.md)

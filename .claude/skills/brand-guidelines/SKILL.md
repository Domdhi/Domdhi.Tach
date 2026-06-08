---
name: brand-guidelines
description: "Use WHEN applying project brand colors, typography, or visual identity to any output — dashboards, reports, emails, presentations, or web components."
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [brand, colors, typography, visual-identity, design-system]
user-invocable: false
allowed-tools: Read Write Edit Grep Glob
---

# Brand Guidelines — Tach (Domdhi.OS)

Tach adopts the **Domdhi.OS Design System** — *Neobrutalist Synthwave*: a
tactical-telemetry aesthetic that reads as a terminal, not a website. Tach is
the **Media** domain. It **ships with the System gem, Deep Amethyst `#9D4EDD`**,
as the owner's reserved default — deliberately omitted from the picker (the five
public gems are selectable; amethyst is reachable only via the custom color input).

Canonical reference (vendored): `docs/design/domdhi-os/` (README, `colors_and_type.css`,
SKILL.md, previews). Adoption decisions: `docs/_project-design.md`.

## Color Palette

### The six domain gems (never desaturate)

| Gem | Domain | HEX | RGB | Usage |
|-----|--------|-----|-----|-------|
| Electric Violet | Media | `#BF40FF` | 191, 64, 255 | Tach's domain; top public swatch |
| Signal Cyan | Tech | `#00F0FF` | 0, 240, 255 | selectable accent |
| Cyber Emerald | Finance | `#00FF9F` | 0, 255, 159 | selectable accent + success status |
| Exit Amber | Freedom | `#FFB000` | 255, 176, 0 | selectable accent |
| Arterial Rose | Fitness | `#FF0055` | 255, 0, 85 | selectable accent + destructive/error |
| Deep Amethyst | System | `#9D4EDD` | 157, 78, 221 | **Shipped default — owner reserved, NOT a swatch** |

### Substrate

| Token | Dark (terminal) | Light (brutalist-light) |
|-------|-----------------|--------------------------|
| Background | `#020202` obsidian void (never `#000`) | `#f4f3ee` warm paper |
| Surface / card | `#0a0a0a` | `#ffffff` |
| Border | `rgba(255,255,255,0.16)` | `#020202` |
| Text primary | `#ededed` phosphor white | `#020202` |
| Text secondary | `#71717a` zinc-500 | `#52525b` |
| Text on accent | `#020202` | `#020202` |

## Typography

Three tiers, never crossed:

| Tier | Font | Role |
|------|------|------|
| Brand | Clash Display (700/600), track `-0.02em` | logo + major titles only |
| Headings / UI | **Space Grotesk** (400–700) | page/panel titles, labels, body |
| Data / telemetry | **JetBrains Mono** (400–700), track `0.05–0.1em`, uppercase | all numbers, metrics, status, button text, `// labels` |

Banned: Inter, Roboto, Open Sans, Arial, Geist, any serif. (Extension CSP forbids
font CDNs → system-stack fallbacks until woff2 are vendored.)

## Form rules (non-negotiable)

- **Zero border-radius. Everywhere.** Rounded corners are a bug.
- **Hard shadows only, no blur.** Brutal offset `4px 4px 0 0 [accent]` (rest) →
  `6px 6px 0 0` + glow halo (hover) → collapse (press). Popup scales to `2px`/`4px`.
- **Glow** = CRT effect: `text-shadow: 0 0 10–18px [accent-glow]`.
- **Motion** = expo-out `cubic-bezier(0.16, 1, 0.3, 1)`. Never linear/ease.
- **No emoji, ever.** Lucide icons or ASCII (`→ ▸ ◆ //`).
- **No gradients on surfaces** — flat fills + ambient radial glow only.
- Casing: `UPPERCASE` for labels/buttons/metrics; `// ABOUT` mono section labels;
  `> STATUS` shell prompts; `[BRACKET]` terminal CTAs.

## CSS Variables (source: `theme.css` / `docs/design/domdhi-os/colors_and_type.css`)

```css
:root {
  --gem-emerald:#00FF9F; --gem-rose:#FF0055; --gem-amber:#FFB000;
  --gem-cyan:#00F0FF;    --gem-violet:#BF40FF; --gem-amethyst:#9D4EDD;
  --font-brand:"Clash Display","Space Grotesk",system-ui,sans-serif;
  --font-header:"Space Grotesk",system-ui,sans-serif;
  --font-mono:"JetBrains Mono","Menlo",monospace;
  --ease-expo:cubic-bezier(0.16,1,0.3,1);
  --border-radius:0px;
  /* accent-derived tints (follow the user's chosen gem) */
  --accent-glow:        color-mix(in srgb, var(--primary-color) 55%, transparent);
  --accent-glow-alpha:  color-mix(in srgb, var(--primary-color) 15%, transparent);
  --accent-shadow:      color-mix(in srgb, var(--primary-color) 45%, transparent);
  --accent-shadow-hover:color-mix(in srgb, var(--primary-color) 60%, transparent);
}
/* dark (terminal) */
:root[data-theme="dark"]{
  --background:#020202; --surface:#0a0a0a; --border:rgba(255,255,255,0.16);
  --text-primary:#ededed; --text-secondary:#71717a;
  --primary-color:#9D4EDD; --on-accent:#020202;
  --shadow:4px 4px 0 0 var(--accent-shadow);
  --status-success:#00FF9F; --status-error:#FF0055;
}
```

## Usage

- **Primary action** → accent fill + `--on-accent` text + brutal shadow.
- **Destructive** → Rose `#FF0055` (distinct from the violet primary).
- **Numbers/telemetry** → JetBrains Mono with accent glow.
- **Toolbar icon** → void square + violet play glyph (follows the user accent at
  runtime). Store/marketing → the full pentagon emblem.
- One gem per surface; the picker offers five (amethyst is the reserved default).
  Never collapse the OS-wide multi-accent identity — but a single product owns a
  single domain color.

---

> **Source**: Auto-populated from `docs/_project-design.md` by `/create:project-design` on 2026-06-07.
> Re-run `/create:project-design` to update. Do not edit this file manually.

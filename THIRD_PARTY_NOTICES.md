# Third-party notices

Tach itself is MIT-licensed (see [LICENSE](LICENSE)). The AI-agent tooling in this
repository (not part of the extension package that ships to the Chrome Web Store)
includes the following third-party content.

## Modern Web Guidance skills

- **What:** the `chrome-extensions` and `modern-web-guidance` agent skills, in
  `.claude/skills/` and `.agents/skills/`.
- **Source:** [GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)
  (npm: `modern-web-guidance`), copied unmodified and recorded in `skills-lock.json`.
- **License:** Apache License 2.0 — full text in
  [third-party/modern-web-guidance/LICENSE](third-party/modern-web-guidance/LICENSE).
- Copyright and attribution belong to the upstream authors (Google / the Chrome team).
  These files are redistributed here under the terms of that license, with no
  warranty; they are excluded from the packaged extension (`npm run package`
  whitelists `src/` only).

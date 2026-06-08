---
name: content-formats
description: "Use WHEN formatting content for a specific platform — LinkedIn posts, newsletters, Twitter threads, or YouTube scripts. Triggers: linkedin, newsletter, twitter, youtube, content format"
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [content, social-media, templates, formats]
user-invocable: false
allowed-tools: Read Grep Glob
---

# Content Formats

Format templates for platform-specific content. Load the relevant file for the target platform before drafting.

## Format Files

| File | Platform | When to Use |
|------|----------|-------------|
| `linkedin-post.md` | LinkedIn | Professional audience updates, thought leadership, career milestones, product announcements targeting a B2B or industry audience |
| `newsletter.md` | Email newsletter | Long-form subscriber content, weekly/monthly digests, curated roundups, deep dives sent directly to an owned audience |
| `twitter-thread.md` | Twitter/X | Rapid-fire idea chains, real-time commentary, technical breakdowns, opinion threads designed for retweet and reply engagement |
| `youtube-script.md` | YouTube | Spoken video scripts — tutorials, vlogs, explainers — with hook, sections, and call-to-action structured for on-camera delivery |

## Usage

Load the matching format file at the start of the task. Each file contains the structural template, length guidance, tone notes, and platform-specific formatting rules for that content type.

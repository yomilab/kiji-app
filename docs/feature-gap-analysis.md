# KiJi Feature Gap Analysis

Reference comparison of KiJi against common open-source and freemium RSS readers.

**Date:** 2026-07-13  
**Scope:** Product feature inventory vs peers (NetNewsWire, Fluent Reader, Reeder, Miniflux/FreshRSS, Feedly, Inoreader, NewsBlur)

---

## Product framing

**KiJi** is a local-first desktop RSS/Atom/JSON reader (Tauri 2 + React + SQLite). Positioning: *“A simple, private reader.”*

- Feeds, articles, saved items, and reading state live in local SQLite
- No accounts, cloud sync, ads, or premium tier
- Platforms: macOS, Windows, Linux (desktop only)

Core loop: subscribe → stations → article list → reader mode → save / Markdown sync / ZIP export.

---

## What KiJi already does well

| Area | Capabilities |
|------|----------------|
| Subscriptions | Add feed URL, OPML import/export, drag-drop OPML, duplicate detection |
| Organization | Stations (feed tags), smart views (All / Unread / Saved), Feed Edit View |
| Reading | Basic feed HTML + reader mode (Defuddle / Readability), typography controls |
| Media | PDF viewer, YouTube embeds, podcast audio player |
| Saved | Save/unsave, Saved smart view, Markdown folder sync, ZIP/CSV import-export |
| Sync (local) | Background scheduler, ETag / Last-Modified, priority scoring, macOS sleep/wake |
| UX | Virtualized lists, keyboard nav (incl. vim-style scroll), themes, custom fonts/app icon |
| Privacy | 100% local; diagnostics export only on request |

**Differentiator vs many peers:** local Markdown sync + saved-article ZIP archive.

---

## High-impact gaps

Expected in common OSS / polished local apps (NetNewsWire, Reeder, Fluent Reader, Miniflux clients).

| Gap | Who has it | KiJi status |
|-----|------------|-------------|
| Multi-device sync | NNW (iCloud), Reeder, Feedbin clients | Absent |
| Mobile companion | NNW, Reeder, Feedly, Inoreader | Desktop-only |
| Act as sync client (Fever / GReader / Miniflux / Feedbin) | Fluent Reader, Reeder Classic, NNW | Absent |
| Star / favorite articles | Nearly every reader | DB + API exist; **no UI** |
| Global full-text search | Inoreader, NNW, Miniflux | Search scoped to current source |
| OS new-article notifications | Most desktop/mobile readers | In-app toasts / sidebar only |
| 3-column layout | Classic Google Reader / NNW / Reeder | Plumbing exists; UI hardcoded to 2-col + deck |
| Article-level tags | Inoreader, FreshRSS, NewsBlur | Feed-level stations only |

---

## Power-user / freemium gaps

Typical of Inoreader, Feedly Pro, FreshRSS, NewsBlur.

- **Rules & automation** — auto-tag, mute keywords, route by title/content
- **Keyword monitoring / alerts** — notify when a term appears in any feed
- **Newsletter → feed** — private email address that becomes RSS
- **Non-RSS sources** — YouTube channels, Reddit, Bluesky, site change tracking as first-class sources
- **AI** — summaries, digests, ranking assistants (e.g. Feedly Leo)
- **Trainable filtering** — NewsBlur-style like/dislike
- **Permanent cloud archive** — history beyond local cleanup
- **Team / shared folders** — enterprise collaboration
- **Translation / TTS / read-aloud**
- **Browser extension** — subscribe-from-page / share-to-reader

---

## Half-built inside KiJi

Peers already ship these; KiJi has backend or partial wiring only.

| Feature | Status |
|---------|--------|
| Highlights & notes on saved articles | Schema + manager APIs; no reader UI |
| Pinned / “feeds with new items” smart view | Query/nav paths; not in sidebar definitions |
| Station colors | Stored in DB; weak UI |
| Customizable shortcuts | Settings shows reference only; not rebindable |
| Discover / directory | Recommended OPML URL only; no Feedly-style browse |

---

## Intentionally out of scope

Consistent with local-first positioning — not “missing” unless product direction changes:

- User accounts / login
- Ads, premium paywalls, telemetry-by-default
- Social network / team product features

---

## Suggested priority (if closing gaps vs peers)

1. **Star UI + global search + OS notifications** — table stakes vs NetNewsWire / Fluent Reader
2. **Sync story** — local multi-device sync, *or* Fever / GReader / Miniflux client mode
3. **Mobile or web companion** — otherwise multi-device users stay on Reeder / NNW
4. **Rules / filters** — if competing with Inoreader power users
5. Finish **highlights/notes** and **3-column layout** — leverage existing codebase work

---

## Bottom line

KiJi matches a good local desktop reader on subscribe / read / save, and beats many peers on Markdown export. It still lacks:

- the **sync + mobile + starring / search / notifications** layer that makes NetNewsWire and Reeder sticky
- the **rules / newsletters / AI** layer that defines freemium commercial readers

---

## Related codebase notes

Useful when revisiting this doc:

- Smart views: All / Unread / Saved (sidebar); `pinned` exists in query paths only
- Starred: `toggleStarred` / cleanup preserve starred; no star control in article UI
- Layout: 3-column settings field exists; `MainArea` uses 2-column + article deck
- Saved: `highlights` / `notes` on `saved_articles`; no editing UI
- Marketing README stays minimal; codebase has more (podcast, PDF, clipboard URL load, standalone article window, diagnostics)

---

*Generated from product inventory + peer comparison. Update when shipping features from the gap lists above.*

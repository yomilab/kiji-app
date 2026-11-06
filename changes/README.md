# Unreleased changes

Each PR with a change users will notice adds one file here instead of editing `CHANGELOG.md`, so PRs never conflict over the changelog. `## Unreleased` in `CHANGELOG.md` stays empty.

**File name:** the branch name with `/` turned into `-`, e.g. `feat/circle-default-icon` → `changes/feat-circle-default-icon.md`.

**Content:** a `type` line and one plain-English line saying what users now see or can do.

```markdown
---
type: fixed
---
Wide images in articles keep their shape.
```

`type` is `added` (shown as New), `changed` (Improved) or `fixed` (Fixed). One feature or fix per line, no technical detail. Refactors, tests, CI and docs need no file.

**On release day:**

- `node scripts/release-changes.mjs --preview` prints the draft `## [x.y.z]` section and a suggested version, and changes nothing.
- After the notes are confirmed (edit or merge the files here first if the wording changes), `node scripts/release-changes.mjs --version x.y.z` writes the section into `CHANGELOG.md` and deletes the files. Lines a PR still added under `## Unreleased` are included too.
- Translations (`CHANGELOG.zh-Hans.md`, `CHANGELOG.ja.md`) are still written by hand from the new English section.

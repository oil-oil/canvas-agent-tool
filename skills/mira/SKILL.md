---
name: mira
description: Use this skill whenever an Agent needs a visual workspace for local Markdown, HTML, images, or videos. Trigger proactively when a task involves previewing images or videos, comparing multiple documents or generated outputs, organizing context across multiple turns, reviewing HTML made from documents, drafting prompts with file references, collecting visual evidence for AI, reading Markdown comments, or keeping task-specific files on a canvas. Also trigger when the user mentions Mira, canvas, visual context, local preview, file nodes, boards, comments, or copying context.
---

# Mira

Mira turns local files into visible Agent context. It has one global home:

```txt
~/.mira/
```

Use boards to separate tasks and topics. Do not create separate Mira homes or rely on project-derived sessions.

## When To Use Mira

Use Mira when seeing files together helps the task:

- Preview Markdown, HTML, images, or videos.
- Compare documents, screenshots, generated HTML, or media assets.
- Keep visual context across a multi-turn task.
- Draft prompts that reference local files.
- Review Markdown comments and connect them to source text.
- Preserve useful media descriptions for future Agents.

## First Step

Call Mira first. Do not pre-check installation separately:

```bash
mira status --json
```

If the command fails because Mira is missing, install it and retry:

```bash
npm install -g https://github.com/oil-oil/mira/archive/refs/heads/main.tar.gz
mira status --json
```

Run `mira migrate --json` after installing or after major upgrades. It migrates older stores into the global `~/.mira` home and reports backup paths.

## Start Or Reuse The Canvas

Use port `3020` by default:

```bash
mira init
mira serve --port 3020
```

If the service is already running, reuse it. The UI is:

```txt
http://localhost:3020
```

## Board Discipline

Create one board per distinct task:

```bash
mira board create "<short task name>" --json
```

For multi-step or batch work, capture the returned `board.id` and pass it explicitly:

```bash
mira add --board <board-id> <file...> --json
mira import --board <board-id> <file...> --json
mira markdown --board <board-id> "prompt draft" --json
mira list --board <board-id> --json
mira context --board <board-id> all
```

This prevents another Agent from changing your CLI target board underneath you.

Use `mira board use <board-id>` only when you intentionally want to change the CLI default target. The browser UI keeps its own visible board, so CLI operations should not depend on what the user is currently viewing.

Delete a board only when the user clearly asks for it:

```bash
mira board delete <board-id> --confirm --json
```

Mira keeps at least one board. Deleting a board removes its board file and comments for that board.

Remove nodes with the CLI instead of editing board JSON by hand:

```bash
mira remove --board <board-id> <node-id...> --json
```

This updates board metadata and lets the browser refresh the visible board reliably.

## Supported Preview Files

```txt
Markdown: .md .mdx .markdown
HTML:     .html .htm
Images:   .png .jpg .jpeg .gif .webp .svg .avif
Videos:   .mp4 .webm .mov .m4v
```

For PDF, spreadsheets, archives, or unknown files, explain that Mira currently previews Markdown, HTML, images, and videos. Convert or extract content first only when the user wants that.

## Put Files On The Canvas

Copy one-off files into Mira:

```bash
mira import --board <board-id> ~/Downloads/brief.md ~/Downloads/mockup.png --json
```

Map a folder through a symlink:

```bash
mira link --board <board-id> ~/Downloads downloads --json
mira files --json
```

After linking, add specific supported files without copying originals:

```bash
mira add --board <board-id> ~/.mira/files/downloads/example.png --json
```

Create a blank Markdown prompt note:

```bash
mira markdown --board <board-id> "prompt draft" --json
```

The UI also supports dragging supported files into the canvas. Treat CLI `import` as the same behavior: copy into the Mira files directory, then add nodes.

Batch `add` and `import` operations are arranged by file type automatically, using the same spacing rules as the UI smart layout.

## Get Context For AI

Use JSON output for automation:

```bash
mira board current --json
mira list --board <board-id> --json
mira comments list --board <board-id> --json
mira timeline --board <board-id> --json --limit 20
mira context --board <board-id> <node-id>
mira read <path>
```

Use `context all` only when the current board is small. For large boards, list nodes first, choose relevant node ids, then fetch context one by one.

Expected context shape:

```txt
# Canvas Context

board_id:
board_title:
node_id:
type:
title:
path:
summary:
asset:

## Content
Exact text when useful. For images and videos, include the file path and relevant visible details requested by the user.

## Comments
Open Markdown comments when present, including `comment_id`, `quote`, and `comment`.
```

## Edit Source Files

Markdown and HTML nodes can map to real files. Read before writing, make a focused edit, then write back:

```bash
mira read <path>
mira write <path> "<new content>"
```

Mira reads and writes files inside the project, copied Mira files, and paths mapped through the Mira files directory. Preserve original images and videos unless the user explicitly asks to overwrite them.

## Asset Metadata And Timeline

Mira stores lightweight asset metadata on nodes when files are imported or created: format, file size, image dimensions when easy to detect, Markdown word count, and HTML title.

If an Agent has inspected an image or video and learned something useful, store that reusable description:

```bash
mira describe --board <board-id> <node-id> "Short visual description useful for future Agents." --json
```

Use Timeline for task memory, not full chat transcripts:

```bash
mira note --board <board-id> "User wants the preview drawer to stay visually minimal." --json
mira timeline --board <board-id> --json --limit 20
```

## Sync Model

Mira writes to disk first, then the running service watches `~/.mira` and pushes browser updates through `/api/events`. If the UI looks stale:

```bash
mira status --json
mira migrate --json
curl -s http://localhost:3020/api/status
```

The CLI and browser should both report `canvasRoot` as `~/.mira`, with no `sessionId`.

## Practical Defaults

- Use `mira` as the command.
- Use the single global home `~/.mira`.
- Start or reuse port `3020`.
- Create a board for each distinct task.
- Pass `--board <board-id>` for batch or multi-step operations.
- Use `import` for one-off files.
- Use `link` plus `add` for folders the user wants to keep in place.
- Use `mira note` for important user decisions and preferences.
- Use `mira describe` after inspecting media when the description will save future visual analysis.
- Read source files when exact text matters; use the visual canvas for orientation and comparison.

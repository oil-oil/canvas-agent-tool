---
name: mira
description: Use this skill whenever the user wants an Agent to preview, organize, or collect context from local Markdown, HTML, image, or video files on Mira, a visual canvas. Trigger for requests mentioning Mira, canvas workspace, visual context board, React Flow preview, local files as nodes, prompt writing with files, copying context for AI, dragging files into a canvas, linking folders into .canvas/files, or opening a local preview service.
---

# Mira

Use Mira when the user wants files to become visible context. Mira is local-first: the installed app provides the CLI and UI, while the current workspace stores layout and files under `.canvas/`.

## Install Mira

If Mira is not installed, install it from GitHub:

```bash
npm install -g https://github.com/oil-oil/mira/archive/refs/heads/main.tar.gz
```

Then verify:

```bash
mira status --json
```

If the repository is already checked out, use the local bin:

```bash
node ./bin/mira.mjs status --json
```

## Start The Canvas

Run commands from the workspace where `.canvas/` should live:

```bash
mira init
mira serve --port 3020
```

The default UI is:

```txt
http://localhost:3020
```

`mira serve` starts the Next.js app and passes `CANVAS_WORKSPACE=<current directory>`, so the UI reads and writes the right workspace.

## Supported Preview Files

```txt
Markdown: .md .mdx .markdown
HTML:     .html .htm
Images:   .png .jpg .jpeg .gif .webp .svg .avif
Videos:   .mp4 .webm .mov .m4v
```

For PDF, spreadsheets, archives, or unknown files, explain that Mira currently previews Markdown, HTML, images, and videos. Convert or extract content first only when the user wants that.

## Put Files On The Canvas

Copy one-off files into the canvas:

```bash
mira import ~/Downloads/brief.md ~/Downloads/mockup.png --json
```

Map a folder through a symlink:

```bash
mira link ~/Downloads downloads --json
mira files --json
```

After linking, add specific supported files without copying originals:

```bash
mira add .canvas/files/downloads/example.png --json
```

Create a blank Markdown prompt note:

```bash
mira markdown "prompt draft" --json
```

The UI also supports dragging supported files into the canvas. Treat CLI `import` as the same behavior: copy into `.canvas/files/drops`, then add nodes.

## Get Context For AI

Use JSON output for automation:

```bash
mira list --json
mira context <node-id>
mira read <path>
```

Use `context all` only when the canvas is small. For large canvases, list nodes first, choose relevant node ids, then fetch context one by one.

Expected context shape:

```txt
# Canvas Context

node_id:
type:
title:
path:
summary:

## Content
Exact text when useful. For images and videos, include the file path and relevant visible details requested by the user.
```

## Edit Source Files

Markdown and HTML nodes can map to real files. Read before writing, make a focused edit, then write back:

```bash
mira read <path>
mira write <path> "<new content>"
```

Mira only reads and writes files inside the workspace or paths already mapped through `.canvas/files` symlinks. Preserve original images and videos unless the user explicitly asks to overwrite them.

## Practical Defaults

- Use `mira` as the command.
- Start on port `3020` unless the user asks for another port.
- Use `import` for one-off files.
- Use `link` plus `add` for folders the user wants to keep in place.
- Create or edit Markdown nodes when the user asks to draft prompts.
- Read source files when exact text matters; do not rely only on visual preview.

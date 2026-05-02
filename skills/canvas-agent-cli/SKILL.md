---
name: canvas-agent-cli
description: Use this skill whenever the user wants an Agent to preview, organize, or collect context from local Markdown, HTML, image, or video files on a visual canvas. Trigger for requests mentioning canvas workspace, visual context board, React Flow preview, local files as nodes, prompt writing with files, copying context for AI, dragging files into a canvas, linking folders into .canvas/files, or opening a local preview service. This skill is especially important when the user expects pictures, videos, Markdown, or HTML to be visible instead of only read as raw text.
---

# Canvas Agent CLI

Use this skill to make local files visible on a local-first canvas and to collect exact context for AI work. The canvas stores layout and metadata in the current workspace under `.canvas/`. Source files can be copied into `.canvas/files/drops` or referenced through symlinks in `.canvas/files`.

## Command Setup

Prefer the installed command:

```bash
canvas-agent status --json
```

If only the source checkout is available, run the local bin from the repository:

```bash
node ./bin/canvas.mjs status --json
```

The default preview service is:

```txt
http://localhost:3020
```

## Supported Preview Files

The canvas can render these file types as visual nodes:

```txt
Markdown: .md .mdx .markdown
HTML:     .html .htm
Images:   .png .jpg .jpeg .gif .webp .svg .avif
Videos:   .mp4 .webm .mov .m4v
```

Treat other files as unsupported for visual preview. If the user asks to add a PDF, archive, spreadsheet, or unknown file, explain that this canvas currently previews Markdown, HTML, images, and videos. Convert or extract useful material first only when the user wants that.

## Common Workflows

### Start Or Inspect The Canvas

Run commands from the workspace where the user wants `.canvas/` to live:

```bash
canvas-agent init
canvas-agent status --json
canvas-agent serve --port 3020
```

Use `serve` when the user wants to view the UI. The command starts the Next.js preview service and points it at the current workspace through `CANVAS_WORKSPACE`.

### Put Files On The Canvas

Use `import` when the user gives files and wants them copied into the canvas:

```bash
canvas-agent import ~/Downloads/brief.md ~/Downloads/mockup.png --json
```

Use `link` when the user wants a folder or original files mapped into `.canvas/files` through symlinks:

```bash
canvas-agent link ~/Downloads downloads --json
canvas-agent files --json
```

After linking, use `add` to create visual nodes for specific supported files without copying them:

```bash
canvas-agent add .canvas/files/downloads/example.png --json
```

Use `markdown` when the user wants a blank Markdown note or prompt draft on the canvas:

```bash
canvas-agent markdown "research notes" --json
```

The UI also supports dragging supported files into the canvas. Treat CLI `import` as the same behavior: copy into `.canvas/files/drops`, then add nodes.

### Get Context For AI

Start with node metadata and only read exact file contents when needed:

```bash
canvas-agent list --json
canvas-agent context <node-id>
canvas-agent read <path>
```

Use `context all` only when the canvas is small enough. For large canvases, list nodes first, choose relevant node ids, then fetch context one by one.

### Edit Source Files

Markdown and HTML nodes can map to real source files. Before writing, read the current content, make a minimal edit, then write it back:

```bash
canvas-agent read <path>
canvas-agent write <path> "<new content>"
```

The CLI only reads and writes paths inside the workspace or paths already mapped through `.canvas/files` symlinks. This protects the user from accidental edits outside the canvas workspace.

For images and videos, preserve original media files unless the user explicitly asks to overwrite them. Media files are hard to diff, so exported derivatives are usually safer.

## Agent Behavior

When the user asks for a visual preview, put files on the canvas instead of only reading them in the terminal. The user expects to see Markdown, HTML, images, and videos as nodes.

When the user asks for context, return a compact context packet:

```txt
# Canvas Context

node_id:
type:
title:
path:
summary:

## Content
Include exact text only when it is useful and not too large.
For images and videos, include the file path and any relevant visible details the user asked about.
```

When the user asks to organize files, prefer canvas operations:

```bash
canvas-agent list --json
canvas-agent files --json
canvas-agent import <supported-files> --json
canvas-agent add <already-linked-supported-files> --json
```

When the user asks to write a prompt, create or edit a Markdown node. This keeps the prompt visible in the canvas and editable in the right-side inspector.

## Practical Defaults

- Use JSON output for automation: `status --json`, `list --json`, `files --json`, `import --json`, `add --json`, `markdown --json`.
- Use `import` for one-off local files.
- Use `link` plus `add` for external folders the user wants to keep in place.
- Start the service on port `3020` unless the user asks for another port.
- Do not assume visual previews contain all needed details. If a task depends on exact text, read the source file.
- Keep original media files unchanged by default.

## Quick Examples

Add a Markdown file and an image, then open the preview service:

```bash
canvas-agent import ~/Downloads/spec.md ~/Downloads/screenshot.png --json
canvas-agent serve --port 3020
```

Map Downloads, add one image without copying it, and fetch its node context:

```bash
canvas-agent link ~/Downloads downloads --json
canvas-agent add .canvas/files/downloads/example.jpg --json
canvas-agent list --json
canvas-agent context <node-id>
```

Create a blank Markdown prompt note:

```bash
canvas-agent markdown "prompt draft" --json
```

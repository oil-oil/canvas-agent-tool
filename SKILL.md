---
name: mira
description: Use this skill whenever the user wants an Agent to preview, organize, or collect context from local Markdown, HTML, image, or video files on Mira, a visual canvas. Trigger for requests mentioning Mira, canvas workspace, visual context board, local files as nodes, prompt writing with files, copying context for AI, dragging files into a canvas, linking folders into .canvas/files, or opening a local preview service.
---

# Mira

Install Mira from GitHub if needed:

```bash
npm install -g https://github.com/oil-oil/mira/archive/refs/heads/main.tar.gz
```

Use Mira from the workspace where `.canvas/` should live:

```bash
mira init
mira status --json
mira serve --port 3020
```

The local UI opens at:

```txt
http://localhost:3020
```

Supported preview files:

```txt
Markdown: .md .mdx .markdown
HTML:     .html .htm
Images:   .png .jpg .jpeg .gif .webp .svg .avif
Videos:   .mp4 .webm .mov .m4v
```

Put files on the canvas:

```bash
mira import ~/Downloads/brief.md ~/Downloads/mockup.png --json
mira link ~/Downloads downloads --json
mira add .canvas/files/downloads/example.png --json
mira markdown "prompt draft" --json
```

Collect context:

```bash
mira list --json
mira context <node-id>
mira read <path>
```

Edit mapped Markdown or HTML files carefully:

```bash
mira read <path>
mira write <path> "<new content>"
```

Prefer JSON output for automation. Use `context all` only for small canvases. Preserve original images and videos unless the user explicitly asks to overwrite them.

# Canvas Agent Tool

Canvas Agent Tool is a local-first visual canvas for AI agents and humans. It turns Markdown, HTML, images, and videos into movable preview nodes, so an agent can collect context from files while you inspect the same material visually.

The tool ships as a Node.js CLI plus a Next.js UI powered by React Flow.

## Why This Exists

Agents are good at reading files, but visual work often needs a shared surface. This canvas gives an agent a simple CLI for adding files, reading context, and starting a preview service, while the user gets a clean board for arranging and inspecting information.

## Features

- Preview Markdown, HTML, images, and videos as canvas nodes.
- Drag supported files directly into the UI.
- Import files by copying them into `.canvas/files/drops`.
- Link external folders into `.canvas/files` with symlinks.
- Create blank Markdown notes for prompt drafts.
- Open a right-side preview panel with double click.
- Copy selected node content or paths from the canvas.
- Use a CLI-friendly JSON mode for agent automation.
- Store all workspace data locally under `.canvas/`.

## Technology

This project uses mainstream, widely adopted web and CLI tooling:

- Next.js App Router for the local service.
- React and TypeScript for the UI.
- React Flow for the canvas.
- Tiptap for Markdown editing.
- Radix UI primitives for context menus.
- Node.js for the CLI and file operations.

## Installation

### Local Development

```bash
git clone https://github.com/oil-oil/canvas-agent-tool.git
cd canvas-agent-tool
pnpm install
pnpm build
```

Run the CLI from the checkout:

```bash
node ./bin/canvas.mjs status --json
node ./bin/canvas.mjs serve --port 3020
```

### Install From The Checkout

For day-to-day local use before an npm release:

```bash
pnpm install
npm link
```

Then use:

```bash
canvas-agent status --json
canvas-agent serve --port 3020
```

### Install From GitHub

After the repository is public:

```bash
npm install -g github:oil-oil/canvas-agent-tool
canvas-agent init
canvas-agent serve --port 3020
```

An npm package can be published later with:

```bash
npm publish
```

## Quick Start

Create or open a workspace folder, then run:

```bash
canvas-agent init
canvas-agent import ~/Downloads/brief.md ~/Downloads/screenshot.png --json
canvas-agent serve --port 3020
```

Open:

```txt
http://localhost:3020
```

The canvas data lives in the current workspace:

```txt
.canvas/
  canvas.json
  files/
    drops/
    notes/
```

## CLI Commands

```txt
canvas-agent init
canvas-agent serve [--port 3020]
canvas-agent open [--port 3020]
canvas-agent status [--json]
canvas-agent list [--json]
canvas-agent files [--json]
canvas-agent import <file...> [--json]
canvas-agent add <file...> [--json]
canvas-agent markdown [title] [--json]
canvas-agent link <path> [name] [--json]
canvas-agent context <node-id|all>
canvas-agent read <path>
canvas-agent write <path> <content>
```

Supported preview files:

```txt
Markdown: .md .mdx .markdown
HTML:     .html .htm
Images:   .png .jpg .jpeg .gif .webp .svg .avif
Videos:   .mp4 .webm .mov .m4v
```

## Working With Agents

The bundled skill is in:

```txt
skills/canvas-agent-cli/SKILL.md
```

Install it into your Codex skills directory if you want agents to discover this workflow automatically:

```bash
mkdir -p ~/.codex/skills/canvas-agent-cli
cp skills/canvas-agent-cli/SKILL.md ~/.codex/skills/canvas-agent-cli/SKILL.md
```

The skill teaches agents to:

- Start or inspect the canvas.
- Import supported local files.
- Link external folders through `.canvas/files`.
- Create Markdown prompt drafts.
- Fetch compact context with `context`, `read`, and `list`.
- Preserve original media files by default.

## Workspace Model

The installed package provides the app code. The current shell directory provides the workspace.

When you run:

```bash
canvas-agent serve --port 3020
```

the CLI starts the Next.js app and passes `CANVAS_WORKSPACE=<current directory>`. The UI and API then read and write `.canvas/` inside that workspace.

You can also set the workspace explicitly:

```bash
CANVAS_WORKSPACE=/path/to/project canvas-agent serve --port 3020
```

## Current Limits

- PDF, spreadsheets, and office documents are not previewed directly yet.
- The service is designed for local use. Do not expose it directly to the public internet.
- Markdown and HTML editing is supported; image and video files are previewed without destructive edits.

## Development

```bash
pnpm install
pnpm dev
pnpm build
```

Useful checks before publishing:

```bash
pnpm build
npm pack --dry-run
```

## License

MIT

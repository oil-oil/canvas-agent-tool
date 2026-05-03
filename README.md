<p align="center">
  <img src="./assets/mira-logo.png" alt="Mira" width="120" />
</p>

# Mira

Mira is a local-first visual canvas for agents. It lets an agent place Markdown, HTML, images, and videos onto a clean board, while you preview the same context visually.

## Install The Skill

```bash
npx skills add oil-oil/mira
```

After installing the skill, ask your agent to use Mira when you want files previewed on a canvas.

## What Mira Does

- Previews Markdown, HTML, images, and videos as movable nodes.
- Lets agents import files, link folders, create Markdown notes, and copy context.
- Tracks lightweight asset metadata such as file size, format, image dimensions, Markdown word count, and HTML title.
- Records a small task timeline through CLI actions and explicit notes.
- Keeps one global Mira home in `~/.mira`; use boards to separate topics.
- Updates the UI through local file events, so CLI changes appear without waiting for polling.
- Opens a local UI at `http://localhost:3020`.

## Agent Quick Start

Once the skill is installed, an agent can install and launch the CLI from GitHub:

```bash
npm install -g https://github.com/oil-oil/mira/archive/refs/heads/main.tar.gz
mira init
mira board create "Homepage Redesign" --json
mira import ~/Downloads/brief.md ~/Downloads/screenshot.png --json
mira serve --port 3020
```

## Commands

```txt
mira init
mira migrate [--json]
mira serve [--port 3020]
mira status [--json]
mira board list [--json]
mira board create <title> [--json]
mira board use <id> [--json]
mira board delete <id> --confirm [--json]
mira comments list [--json]
mira comments node <node-id> [--json]
mira note <text> [--json]
mira timeline [--json] [--limit n]
mira describe <node-id> <text> [--json]
mira list [--json]
mira remove <node-id...> [--json]
mira files [--json]
mira import <file...> [--json]
mira add <file...> [--json]
mira markdown [title] [--json]
mira link <path> [name] [--json]
mira context <node-id|all>
mira read <path>
mira write <path> <content>
```

By default, Mira stores canvas data in:

```txt
~/.mira/
```

Run `mira status --json` to see Mira Home and the CLI default board. The browser remembers its own visible board, so Agent commands do not pull the UI away from what you are viewing. Run `mira migrate --json` after upgrades to fold older `~/.mira/sessions/*` or project `.canvas/` data into the global home; migration records backups under `~/.mira-backups`.

Batch imports are automatically grouped by file type and arranged with the same spacing as the UI smart layout. Board deletion always requires confirmation: the UI asks twice, and the CLI requires `--confirm`.

## Supported Files

```txt
Markdown: .md .mdx .markdown
HTML:     .html .htm
Images:   .png .jpg .jpeg .gif .webp .svg .avif
Videos:   .mp4 .webm .mov .m4v
```

## Tech Stack

Mira uses Next.js, React, TypeScript, React Flow, Tiptap, Radix UI, and a Node.js CLI.

## License

MIT

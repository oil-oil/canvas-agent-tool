# Contributing

Thanks for helping improve Canvas Agent Tool.

## Development Setup

```bash
pnpm install
pnpm dev
```

Run the production build before opening a pull request:

```bash
pnpm build
```

## Pull Request Guidelines

- Keep changes focused and easy to review.
- Preserve the local-first workspace model.
- Avoid destructive edits to user media files.
- Update `README.md` and the bundled skill when CLI behavior changes.
- Include screenshots or short notes for UI changes.

## Supported Files

The canvas currently previews Markdown, HTML, images, and videos. New preview types should include CLI support, UI rendering, and context behavior.

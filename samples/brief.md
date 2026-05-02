# Canvas Agent Tool

This canvas service turns files into movable, editable, annotatable nodes with copyable context.

## First Release Capabilities

- Markdown and HTML can be edited in the canvas and written back to source files.
- Images and videos can be previewed directly in the canvas and opened in the right-side preview panel.
- Prompt nodes can reference nearby materials to organize input for AI.
- Files are managed through `.canvas/files`, with support for symlinks to external folders.

## Draft Agent Workflow

When an Agent sees a canvas node, it should copy the node context first. The context includes paths, summaries, and only the necessary excerpts. If full content is needed, the Agent should read the source file through the local service.

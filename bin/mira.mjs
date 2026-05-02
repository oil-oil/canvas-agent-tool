#!/usr/bin/env node

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(process.env.CANVAS_WORKSPACE ?? process.cwd());
const projectRoot = workspaceRoot;
const canvasRoot = path.join(workspaceRoot, ".canvas");
const filesRoot = path.join(canvasRoot, "files");
const dropsRoot = path.join(filesRoot, "drops");
const notesRoot = path.join(filesRoot, "notes");
const boardsRoot = path.join(canvasRoot, "boards");
const stateFile = path.join(canvasRoot, "state.json");
const commentsFile = path.join(canvasRoot, "comments.json");
const canvasFile = path.join(canvasRoot, "canvas.json");
const defaultBoardId = "main";
const renderableTypes = new Set(["markdown", "html", "image", "video"]);

function usage() {
  const invokedName = path.basename(process.argv[1] ?? "mira");
  const commandName = invokedName === "mira.mjs" ? "mira" : invokedName;
  console.log(`${commandName} <command>

Commands:
  init                         Initialize the .canvas directory
  serve [--port 3020]          Start the canvas service
  open [--port 3020]           Open the canvas service in the browser
  status [--json]              Print canvas paths and node counts
  board list [--json]          List boards
  board current [--json]       Print the current board
  board create <title> [--json] Create and switch to a board
  board use <id> [--json]      Switch to a board
  comments list [--json]       List open comments on the current board
  comments node <id> [--json]  List comments for a node
  comments file <path> [--json] List comments for a file
  comments resolve <id> [--json] Resolve a comment
  list [--json]                List canvas nodes
  files [--json]               List files under .canvas/files
  import <file...> [--json]    Copy previewable files into the canvas and add nodes
  add <file...> [--json]       Add already-mapped files as nodes without copying them
  markdown [title] [--json]    Create an empty Markdown file and add it as a node
  link <path> [name] [--json]  Symlink a file or folder into .canvas/files
  context <node-id|all>        Print node context
  read <path>                  Read a text file already added to the canvas
  write <path> <content>       Write a text file already added to the canvas

Supported preview files:
  markdown: .md .mdx .markdown
  html:     .html .htm
  image:    .png .jpg .jpeg .gif .webp .svg .avif
  video:    .mp4 .webm .mov .m4v
`);
}

function inferSourceType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".md", ".mdx", ".markdown"].includes(ext)) return "markdown";
  if ([".html", ".htm"].includes(ext)) return "html";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"].includes(ext)) return "image";
  if ([".mp4", ".webm", ".mov", ".m4v"].includes(ext)) return "video";
  return "file";
}

function safeName(input) {
  return input.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-") || `file-${Date.now()}`;
}

function safeBoardId(input) {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 72) || `board-${Date.now()}`
  );
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function getOptionValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function withoutFlags(args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (["--board", "--port", "--status"].includes(arg)) index += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function isRenderable(filePath) {
  return renderableTypes.has(inferSourceType(filePath));
}

async function ensureCanvas() {
  await fs.mkdir(dropsRoot, { recursive: true });
  await fs.mkdir(notesRoot, { recursive: true });
  await fs.mkdir(boardsRoot, { recursive: true });

  let state = await readJson(stateFile, null);
  const timestamp = new Date().toISOString();
  if (!state || !Array.isArray(state.boards) || !state.boards.length) {
    state = {
      currentBoardId: defaultBoardId,
      boards: [
        {
          id: defaultBoardId,
          title: "Main",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ]
    };
  }

  if (!state.currentBoardId || !state.boards.some((board) => board.id === state.currentBoardId)) {
    state.currentBoardId = state.boards[0]?.id ?? defaultBoardId;
  }

  for (const board of state.boards) {
    try {
      await fs.access(boardFile(board.id));
    } catch {
      const document = board.id === defaultBoardId ? await readJson(canvasFile, { nodes: [], edges: [] }) : { nodes: [], edges: [] };
      await writeJson(boardFile(board.id), document);
    }
  }

  try {
    await fs.access(commentsFile);
  } catch {
    await writeJson(commentsFile, { comments: [] });
  }

  await writeJson(stateFile, state);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function boardFile(boardId) {
  return path.join(boardsRoot, `${safeBoardId(boardId)}.json`);
}

function resolveUserPath(userPath) {
  if (!userPath) throw new Error("Missing file path");
  return path.isAbsolute(userPath) ? path.normalize(userPath) : path.normalize(path.join(process.cwd(), userPath));
}

async function realpathIfExists(targetPath) {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return null;
  }
}

async function isAllowedPath(targetPath) {
  await ensureCanvas();
  const resolved = resolveUserPath(targetPath);
  const realTarget = await realpathIfExists(resolved);
  if (!realTarget) return false;

  const realProject = await fs.realpath(projectRoot);
  if (realTarget === realProject || realTarget.startsWith(`${realProject}${path.sep}`)) {
    return true;
  }

  const entries = await fs.readdir(filesRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const linkPath = path.join(filesRoot, entry.name);
    const realLink = await realpathIfExists(linkPath);
    if (realLink && (realTarget === realLink || realTarget.startsWith(`${realLink}${path.sep}`))) {
      return true;
    }
  }

  return false;
}

async function assertAllowedPath(targetPath) {
  const resolved = resolveUserPath(targetPath);
  if (!(await isAllowedPath(resolved))) {
    throw new Error("This path has not been added to the canvas directory. Import it with canvas import or map it with canvas link first.");
  }
  return resolved;
}

async function readState() {
  await ensureCanvas();
  return readJson(stateFile, { currentBoardId: defaultBoardId, boards: [] });
}

async function resolveBoardId(args) {
  const requested = getOptionValue(args, "--board");
  const state = await readState();
  const boardId = safeBoardId(requested ?? state.currentBoardId);
  if (!state.boards.some((board) => board.id === boardId)) {
    throw new Error(`No board found for ${requested ?? boardId}`);
  }
  return boardId;
}

async function readCanvas(args = []) {
  const boardId = await resolveBoardId(args);
  return readJson(boardFile(boardId), { nodes: [], edges: [] });
}

async function writeCanvas(document, args = []) {
  await ensureCanvas();
  const state = await readState();
  const boardId = await resolveBoardId(args);
  const board = state.boards.find((item) => item.id === boardId);
  if (board) board.updatedAt = new Date().toISOString();
  await writeJson(boardFile(boardId), document);
  await writeJson(stateFile, state);
}

async function currentBoard(args = []) {
  const state = await readState();
  const boardId = await resolveBoardId(args);
  return state.boards.find((board) => board.id === boardId) ?? state.boards[0];
}

async function readComments() {
  await ensureCanvas();
  return readJson(commentsFile, { comments: [] });
}

async function writeComments(document) {
  await ensureCanvas();
  await writeJson(commentsFile, document);
}

async function listComments(args = [], filters = {}) {
  const board = await currentBoard(args);
  const status = getOptionValue(args, "--status") ?? "open";
  const document = await readComments();
  return {
    board,
    comments: document.comments.filter((comment) => {
      if (comment.boardId !== board.id) return false;
      if (status !== "all" && comment.status !== status) return false;
      if (filters.nodeId && comment.nodeId !== filters.nodeId) return false;
      if (filters.path && comment.path !== filters.path) return false;
      return true;
    })
  };
}

async function uniquePath(directory, name) {
  const parsed = path.parse(safeName(name));
  let candidate = path.join(directory, `${parsed.name}${parsed.ext}`);
  let index = 1;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(directory, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

async function uniqueLinkPath(name) {
  let candidate = path.join(filesRoot, safeName(name));
  let index = 1;
  while (true) {
    try {
      await fs.lstat(candidate);
      const parsed = path.parse(safeName(name));
      candidate = path.join(filesRoot, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

function nextNodePosition(index) {
  return {
    x: 96 + (index % 4) * 320,
    y: 96 + Math.floor(index / 4) * 280
  };
}

function nodeForFile(filePath, index, prefix = "cli") {
  const sourceType = inferSourceType(filePath);
  return {
    id: `${prefix}-${sourceType}-${Date.now()}-${index}`,
    type: sourceType,
    position: nextNodePosition(index),
    data: {
      title: path.basename(filePath),
      path: filePath,
      sourceType,
      summary: filePath,
      preview: sourceType === "image" || sourceType === "video"
    }
  };
}

async function importFiles(args) {
  const json = hasFlag(args, "--json");
  const paths = withoutFlags(args);
  if (!paths.length) throw new Error("Provide at least one file path to import.");
  const document = await readCanvas(args);
  const start = document.nodes.length;
  const nodes = [];

  for (const [index, input] of paths.entries()) {
    const source = path.resolve(input);
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new Error(`${source} is not a file`);
    if (!isRenderable(source)) throw new Error(`${source} cannot be previewed yet. Import Markdown, HTML, images, or videos.`);
    const target = await uniquePath(dropsRoot, path.basename(source));
    await fs.copyFile(source, target);
    nodes.push(nodeForFile(target, start + index));
  }

  document.nodes.push(...nodes);
  document.edges = document.edges ?? [];
  await writeCanvas(document, args);
  const result = { board: await currentBoard(args), imported: nodes.length, nodes };
  if (json) printJson(result);
  else {
    for (const node of nodes) console.log(`${node.id}\t${node.data.sourceType}\t${node.data.path}`);
  }
}

async function addFiles(args) {
  const json = hasFlag(args, "--json");
  const paths = withoutFlags(args);
  if (!paths.length) throw new Error("Provide at least one file path to add to the canvas.");
  const document = await readCanvas(args);
  const start = document.nodes.length;
  const nodes = [];

  for (const [index, input] of paths.entries()) {
    const source = await assertAllowedPath(input);
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new Error(`${source} is not a file`);
    if (!isRenderable(source)) throw new Error(`${source} cannot be previewed yet. Add Markdown, HTML, images, or videos.`);
    nodes.push(nodeForFile(source, start + index, "cli-add"));
  }

  document.nodes.push(...nodes);
  document.edges = document.edges ?? [];
  await writeCanvas(document, args);
  const result = { board: await currentBoard(args), added: nodes.length, nodes };
  if (json) printJson(result);
  else {
    for (const node of nodes) console.log(`${node.id}\t${node.data.sourceType}\t${node.data.path}`);
  }
}

async function createMarkdown(args) {
  const json = hasFlag(args, "--json");
  const titleInput = withoutFlags(args).join(" ").trim();
  const baseName = safeName(titleInput || `untitled-${Date.now()}`);
  const fileName = baseName.endsWith(".md") ? baseName : `${baseName}.md`;
  await ensureCanvas();
  const target = await uniquePath(notesRoot, fileName);
  await fs.writeFile(target, "", "utf8");
  const document = await readCanvas(args);
  const node = nodeForFile(target, document.nodes.length, "cli-note");
  document.nodes.push(node);
  document.edges = document.edges ?? [];
  await writeCanvas(document, args);
  const result = { board: await currentBoard(args), created: true, node, path: target };
  if (json) printJson(result);
  else console.log(`${node.id}\tmarkdown\t${target}`);
}

async function linkPath(args) {
  const json = hasFlag(args, "--json");
  const [targetInput, nameInput] = withoutFlags(args);
  if (!targetInput) throw new Error("Provide a path to link.");
  await ensureCanvas();
  const target = path.resolve(targetInput);
  await fs.access(target);
  const linkPath = await uniqueLinkPath(nameInput || path.basename(target));
  await fs.symlink(target, linkPath);
  const result = { ok: true, linkPath, target };
  if (json) printJson(result);
  else console.log(`${linkPath}\t->\t${target}`);
}

async function listNodes(args) {
  const json = hasFlag(args, "--json");
  const document = await readCanvas(args);
  if (json) return printJson({ board: await currentBoard(args), nodes: document.nodes });
  for (const node of document.nodes) {
    console.log(`${node.id}\t${node.data.sourceType}\t${node.data.title}\t${node.data.path ?? ""}`);
  }
}

async function scanFiles() {
  await ensureCanvas();
  const files = [];
  async function walk(currentPath, depth) {
    if (depth > 3) return;
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const itemPath = path.join(currentPath, entry.name);
      const stat = await fs.lstat(itemPath);
      const linked = stat.isSymbolicLink();
      if (entry.isDirectory() || linked) {
        const real = await realpathIfExists(itemPath);
        const targetStat = real ? await fs.stat(real).catch(() => null) : null;
        if (entry.isDirectory() || targetStat?.isDirectory()) {
          await walk(itemPath, depth + 1);
          continue;
        }
      }
      files.push({
        name: entry.name,
        path: itemPath,
        sourceType: inferSourceType(itemPath),
        linked
      });
    }
  }
  await walk(filesRoot, 0);
  return files;
}

async function listFiles(args) {
  const json = hasFlag(args, "--json");
  const files = await scanFiles();
  if (json) return printJson({ files });
  for (const file of files) {
    console.log(`${file.sourceType}\t${file.path}${file.linked ? "\tlinked" : ""}`);
  }
}

async function boardCommand(args) {
  const [action, ...rest] = args;
  const json = hasFlag(args, "--json");
  const state = await readState();

  if (!action || action === "list") {
    if (json) return printJson(state);
    for (const board of state.boards) {
      const marker = board.id === state.currentBoardId ? "*" : " ";
      console.log(`${marker}\t${board.id}\t${board.title}`);
    }
    return;
  }

  if (action === "current") {
    const board = state.boards.find((item) => item.id === state.currentBoardId) ?? state.boards[0];
    if (json) return printJson({ board });
    if (board) console.log(`${board.id}\t${board.title}`);
    return;
  }

  if (action === "create") {
    const title = withoutFlags(rest).join(" ").trim();
    if (!title) throw new Error("Provide a board title.");
    const baseId = safeBoardId(title);
    let id = baseId;
    let index = 2;
    while (state.boards.some((board) => board.id === id)) {
      id = `${baseId}-${index}`;
      index += 1;
    }
    const timestamp = new Date().toISOString();
    const board = { id, title, createdAt: timestamp, updatedAt: timestamp };
    state.boards.push(board);
    state.currentBoardId = id;
    await writeJson(boardFile(id), { nodes: [], edges: [] });
    await writeJson(stateFile, state);
    if (json) return printJson({ board, boards: state.boards, currentBoardId: state.currentBoardId });
    console.log(`${board.id}\t${board.title}`);
    return;
  }

  if (action === "use") {
    const [requested] = withoutFlags(rest);
    if (!requested) throw new Error("Provide a board id.");
    const boardId = safeBoardId(requested);
    const board = state.boards.find((item) => item.id === boardId);
    if (!board) throw new Error(`No board found for ${requested}`);
    state.currentBoardId = board.id;
    await writeJson(stateFile, state);
    if (json) return printJson({ board, boards: state.boards, currentBoardId: state.currentBoardId });
    console.log(`${board.id}\t${board.title}`);
    return;
  }

  throw new Error(`Unknown board command: ${action}`);
}

async function commentsCommand(args) {
  const [action, ...rest] = args;
  const json = hasFlag(args, "--json");

  if (!action || action === "list") {
    const result = await listComments(args);
    if (json) return printJson(result);
    for (const comment of result.comments) {
      console.log(`${comment.id}\t${comment.nodeId}\t${comment.title ?? ""}\t${comment.quote}\t${comment.comment}`);
    }
    return;
  }

  if (action === "node") {
    const [nodeId] = withoutFlags(rest);
    if (!nodeId) throw new Error("Provide a node id.");
    const result = await listComments(args, { nodeId });
    if (json) return printJson(result);
    for (const comment of result.comments) {
      console.log(`${comment.id}\t${comment.quote}\t${comment.comment}`);
    }
    return;
  }

  if (action === "file") {
    const [filePath] = withoutFlags(rest);
    if (!filePath) throw new Error("Provide a file path.");
    const result = await listComments(args, { path: resolveUserPath(filePath) });
    if (json) return printJson(result);
    for (const comment of result.comments) {
      console.log(`${comment.id}\t${comment.nodeId}\t${comment.quote}\t${comment.comment}`);
    }
    return;
  }

  if (action === "resolve") {
    const [commentId] = withoutFlags(rest);
    if (!commentId) throw new Error("Provide a comment id.");
    const document = await readComments();
    const comment = document.comments.find((item) => item.id === commentId);
    if (!comment) throw new Error(`No comment found for ${commentId}`);
    comment.status = "resolved";
    comment.updatedAt = new Date().toISOString();
    await writeComments(document);
    if (json) return printJson({ comment });
    console.log(`${comment.id}\tresolved`);
    return;
  }

  throw new Error(`Unknown comments command: ${action}`);
}

async function status(args) {
  const json = hasFlag(args, "--json");
  const document = await readCanvas(args);
  const files = await scanFiles();
  const state = await readState();
  const board = await currentBoard(args);
  const result = {
    appRoot,
    workspaceRoot,
    projectRoot,
    canvasRoot,
    boardsRoot,
    filesRoot,
    canvasFile,
    commentsFile,
    stateFile,
    board,
    boards: state.boards,
    serviceUrl: "http://localhost:3020",
    nodes: document.nodes.length,
    files: files.length
  };
  if (json) printJson(result);
  else {
    console.log(`app\t${appRoot}`);
    console.log(`workspace\t${workspaceRoot}`);
    console.log(`canvas\t${canvasRoot}`);
    console.log(`board\t${board.id}\t${board.title}`);
    console.log(`files\t${filesRoot}`);
    console.log(`service\t${result.serviceUrl}`);
    console.log(`nodes\t${result.nodes}`);
    console.log(`files\t${result.files}`);
  }
}

async function contextFor(args) {
  const [id] = withoutFlags(args);
  if (!id) throw new Error("Provide a node id.");
  const document = await readCanvas(args);
  const board = await currentBoard(args);
  const targets = id === "all" ? document.nodes : document.nodes.filter((item) => item.id === id);
  if (!targets.length) throw new Error(`No node found for ${id}`);
  const commentsDocument = await readComments();
  for (const node of targets) {
    let content = node.data.content ?? "";
    if (!content && node.data.path && ["markdown", "html", "file"].includes(node.data.sourceType)) {
      content = await fs.readFile(node.data.path, "utf8").catch(() => "");
    }
    const comments = commentsDocument.comments.filter(
      (comment) => comment.boardId === board.id && comment.status === "open" && (comment.nodeId === node.id || (node.data.path && comment.path === node.data.path))
    );
    console.log(
      [
        "# Canvas Context",
        "",
        `board_id: ${board.id}`,
        `board_title: ${board.title}`,
        `node_id: ${node.id}`,
        `type: ${node.data.sourceType}`,
        `title: ${node.data.title}`,
        node.data.path ? `path: ${node.data.path}` : "",
        node.data.summary ? `summary: ${node.data.summary}` : "",
        "",
        "## Content",
        content || "(This node mainly provides a media path or canvas metadata.)",
        comments.length ? "\n## Comments" : "",
        ...comments.map((comment) => [`comment_id: ${comment.id}`, `quote: ${comment.quote}`, `comment: ${comment.comment}`].join("\n"))
      ]
        .filter(Boolean)
        .join("\n")
    );
    if (targets.length > 1) console.log("\n---\n");
  }
}

async function serve(args) {
  const portIndex = args.indexOf("--port");
  const port = portIndex >= 0 ? args[portIndex + 1] : "3020";
  const nextBin = path.join(appRoot, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "--port", port], {
    cwd: appRoot,
    env: {
      ...process.env,
      CANVAS_WORKSPACE: workspaceRoot,
      PORT: port
    },
    stdio: "inherit"
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

async function openCanvas(args) {
  const portIndex = args.indexOf("--port");
  const port = portIndex >= 0 ? args[portIndex + 1] : "3020";
  spawn("open", [`http://localhost:${port}`], {
    cwd: workspaceRoot,
    detached: true,
    stdio: "ignore"
  }).unref();
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "init") return ensureCanvas();
  if (command === "serve") return serve(args);
  if (command === "open") return openCanvas(args);
  if (command === "status") return status(args);
  if (command === "board") return boardCommand(args);
  if (command === "comments") return commentsCommand(args);
  if (command === "list") return listNodes(args);
  if (command === "files") return listFiles(args);
  if (command === "import") return importFiles(args);
  if (command === "add") return addFiles(args);
  if (command === "markdown") return createMarkdown(args);
  if (command === "link") return linkPath(args);
  if (command === "context") return contextFor(args);
  if (command === "read") return console.log(await fs.readFile(await assertAllowedPath(args[0]), "utf8"));
  if (command === "write") return fs.writeFile(await assertAllowedPath(args[0]), args.slice(1).join(" "), "utf8");

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

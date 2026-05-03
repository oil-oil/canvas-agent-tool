#!/usr/bin/env node

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceWorkspaceRoot = path.resolve(process.env.MIRA_SOURCE_WORKSPACE ?? process.env.CANVAS_WORKSPACE ?? process.cwd());
const workspaceRoot = sourceWorkspaceRoot;
const projectRoot = sourceWorkspaceRoot;
const miraHome = path.resolve(process.env.MIRA_HOME ?? path.join(os.homedir(), ".mira"));
const storageMode = process.env.MIRA_STORAGE ?? "home";
const localCanvasRoot = path.join(sourceWorkspaceRoot, ".canvas");
const canvasRoot = storageMode === "local" ? localCanvasRoot : miraHome;
const filesRoot = path.join(canvasRoot, "files");
const dropsRoot = path.join(filesRoot, "drops");
const notesRoot = path.join(filesRoot, "notes");
const boardsRoot = path.join(canvasRoot, "boards");
const metaFile = path.join(canvasRoot, "meta.json");
const migrationFile = path.join(canvasRoot, "migration.json");
const backupsRoot = path.join(os.homedir(), ".mira-backups");
const stateFile = path.join(canvasRoot, "state.json");
const commentsFile = path.join(canvasRoot, "comments.json");
const timelineFile = path.join(canvasRoot, "timeline.json");
const canvasFile = path.join(canvasRoot, "canvas.json");
const defaultBoardId = "main";
const migrationStartedAt = new Date().toISOString().replace(/[:.]/g, "-");
const renderableTypes = new Set(["markdown", "html", "image", "video"]);
const defaultNodeSizes = {
  markdown: { width: 720, height: 820 },
  html: { width: 960, height: 600 },
  image: { width: 260, height: 220 },
  video: { width: 300, height: 210 },
  prompt: { width: 420, height: 320 },
  file: { width: 300, height: 230 }
};
const arrangeGap = 48;
const arrangeRowGap = 64;
const layoutTypeOrder = new Map([
  ["image", 0],
  ["video", 1],
  ["markdown", 2],
  ["html", 3],
  ["prompt", 4],
  ["file", 5]
]);

function usage() {
  const invokedName = path.basename(process.argv[1] ?? "mira");
  const commandName = invokedName === "mira.mjs" ? "mira" : invokedName;
  console.log(`${commandName} <command>

Commands:
  init                         Initialize Mira Home
  serve [--port 3020]          Start the canvas service
  open [--port 3020]           Open the canvas service in the browser
  status [--json]              Print canvas paths and node counts
  migrate [--json]             Migrate older Mira stores into the global Mira Home
  board list [--json]          List boards
  board current [--json]       Print the current board
  board create <title> [--json] Create and switch to a board
  board use <id> [--json]      Switch to a board
  board delete <id> --confirm [--json] Delete a board
  comments list [--json]       List open comments on the current board
  comments node <id> [--json]  List comments for a node
  comments file <path> [--json] List comments for a file
  comments resolve <id> [--json] Resolve a comment
  note <text> [--json]         Add a short timeline note to the current board
  timeline [--json] [--limit n] List recent timeline events
  describe <node-id> <text> [--json] Store an AI-visible description on a node
  list [--json]                List canvas nodes
  remove <node-id...> [--json] Remove nodes from the canvas
  files [--json]               List files under the Mira files directory
  import <file...> [--json]    Copy previewable files into the canvas and add nodes
  add <file...> [--json]       Add already-mapped files as nodes without copying them
  markdown [title] [--json]    Create an empty Markdown file and add it as a node
  link <path> [name] [--json]  Symlink a file or folder into the Mira files directory
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
      if (["--board", "--port", "--status", "--limit"].includes(arg)) index += 1;
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

function imageSizeFromBuffer(buffer, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png" && buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (ext === ".gif" && buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if ((ext === ".jpg" || ext === ".jpeg") && buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  if (ext === ".webp" && buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buffer.length >= 30) {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
  }
  return {};
}

function svgSizeFromText(text) {
  const width = text.match(/\bwidth=["']?([0-9.]+)/i)?.[1];
  const height = text.match(/\bheight=["']?([0-9.]+)/i)?.[1];
  if (width && height) return { width: Math.round(Number(width)), height: Math.round(Number(height)) };
  const viewBox = text.match(/\bviewBox=["'][^"']*?([0-9.]+)\s+([0-9.]+)["']/i);
  if (viewBox) return { width: Math.round(Number(viewBox[1])), height: Math.round(Number(viewBox[2])) };
  return {};
}

async function getAssetMetadata(filePath) {
  const stat = await fs.stat(filePath);
  const sourceType = inferSourceType(filePath);
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const metadata = {
    format: ext || sourceType,
    sizeBytes: stat.size,
    updatedAt: stat.mtime.toISOString()
  };
  if (sourceType === "markdown") {
    const text = await fs.readFile(filePath, "utf8").catch(() => "");
    metadata.title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
    metadata.words = text.trim() ? text.trim().split(/\s+/).length : 0;
  } else if (sourceType === "html") {
    const text = await fs.readFile(filePath, "utf8").catch(() => "");
    metadata.title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  } else if (sourceType === "image") {
    if (ext === "svg") Object.assign(metadata, svgSizeFromText(await fs.readFile(filePath, "utf8").catch(() => "")));
    else Object.assign(metadata, imageSizeFromBuffer(await fs.readFile(filePath), filePath));
  }
  return metadata;
}

async function countCanvasNodes(root) {
  const state = await readJson(path.join(root, "state.json"), null);
  if (state?.boards?.length) {
    let count = 0;
    for (const board of state.boards) {
      const document = await readJson(path.join(root, "boards", `${safeBoardId(board.id)}.json`), { nodes: [] });
      count += Array.isArray(document.nodes) ? document.nodes.length : 0;
    }
    return count;
  }
  const legacyDocument = await readJson(path.join(root, "canvas.json"), { nodes: [] });
  return Array.isArray(legacyDocument.nodes) ? legacyDocument.nodes.length : 0;
}

function remapPathValue(value, fromRoot, toRoot) {
  if (typeof value === "string") {
    if (value === fromRoot || value.startsWith(`${fromRoot}${path.sep}`)) {
      return path.join(toRoot, path.relative(fromRoot, value));
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => remapPathValue(item, fromRoot, toRoot));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapPathValue(item, fromRoot, toRoot)]));
  }
  return value;
}

function remapBoardIdValue(value, boardIds) {
  if (Array.isArray(value)) return value.map((item) => remapBoardIdValue(item, boardIds));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (key === "boardId" && typeof item === "string" && boardIds.has(item)) return [key, boardIds.get(item)];
        return [key, remapBoardIdValue(item, boardIds)];
      })
    );
  }
  return value;
}

function uniqueBoardId(baseInput, usedIds) {
  const base = safeBoardId(baseInput);
  let id = base;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  usedIds.add(id);
  return id;
}

async function mergeLegacyStore(root, label, state, comments, timeline) {
  const legacyState = await readJson(path.join(root, "state.json"), null);
  if (!legacyState?.boards?.length) return false;

  const usedIds = new Set(state.boards.map((board) => board.id));
  const boardIds = new Map();
  const filesSourceRoot = path.join(root, "files");
  const filesTargetRoot = path.join(filesRoot, "legacy", safeName(label));
  if (await realpathIfExists(filesSourceRoot)) {
    await copyLegacyFiles(filesSourceRoot, filesTargetRoot);
  }

  for (const board of legacyState.boards) {
    const document = await readJson(path.join(root, "boards", `${safeBoardId(board.id)}.json`), { nodes: [], edges: [] });
    const fallbackDocument = board.id === defaultBoardId ? await readJson(path.join(root, "canvas.json"), { nodes: [], edges: [] }) : { nodes: [], edges: [] };
    const sourceDocument = document.nodes?.length ? document : fallbackDocument;
    const hasContent = Boolean(sourceDocument.nodes?.length || sourceDocument.edges?.length);
    if (!hasContent && board.id === defaultBoardId && usedIds.has(defaultBoardId)) continue;

    const nextId = usedIds.has(board.id) ? uniqueBoardId(`${safeName(label)}-${board.id}`, usedIds) : uniqueBoardId(board.id, usedIds);
    boardIds.set(board.id, nextId);
    await writeJson(boardFile(nextId), remapPathValue(sourceDocument, filesSourceRoot, filesTargetRoot));
    state.boards.push({
      ...board,
      id: nextId,
      title: nextId === board.id ? board.title : `${board.title} (${label})`
    });
  }

  if (!boardIds.size) return false;

  const legacyComments = await readJson(path.join(root, "comments.json"), { comments: [] });
  const existingCommentIds = new Set(comments.comments.map((comment) => comment.id));
  for (const legacyComment of legacyComments.comments ?? []) {
    if (!boardIds.has(legacyComment.boardId)) continue;
    const remapped = remapBoardIdValue(remapPathValue(legacyComment, filesSourceRoot, filesTargetRoot), boardIds);
    if (existingCommentIds.has(remapped.id)) remapped.id = `${safeName(label)}-${remapped.id}`;
    existingCommentIds.add(remapped.id);
    comments.comments.push(remapped);
  }

  const legacyTimeline = await readJson(path.join(root, "timeline.json"), { events: [] });
  const existingEventIds = new Set(timeline.events.map((event) => event.id));
  for (const legacyEvent of legacyTimeline.events ?? []) {
    if (legacyEvent.boardId && !boardIds.has(legacyEvent.boardId)) continue;
    const remapped = remapBoardIdValue(remapPathValue(legacyEvent, filesSourceRoot, filesTargetRoot), boardIds);
    if (existingEventIds.has(remapped.id)) remapped.id = `${safeName(label)}-${remapped.id}`;
    existingEventIds.add(remapped.id);
    timeline.events.push(remapped);
  }

  return true;
}

async function copyLegacyFiles(sourceRoot, targetRoot) {
  if (sourceRoot === targetRoot || targetRoot.startsWith(`${sourceRoot}${path.sep}`)) return;
  await fs.mkdir(targetRoot, { recursive: true });
  try {
    await fs.cp(sourceRoot, targetRoot, { recursive: true, force: true, errorOnExist: false });
    return;
  } catch {
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const source = path.join(sourceRoot, entry.name);
      const target = path.join(targetRoot, entry.name);
      await fs.cp(source, target, { recursive: true, force: true, errorOnExist: false }).catch(() => undefined);
    }
  }
}

async function backupMigrationSource(root, label) {
  if (storageMode === "local") return undefined;
  const backupRoot = path.join(backupsRoot, `global-migration-${migrationStartedAt}`, safeName(label));
  await fs.mkdir(backupRoot, { recursive: true });
  for (const name of ["state.json", "canvas.json", "comments.json", "timeline.json", "meta.json"]) {
    await fs.copyFile(path.join(root, name), path.join(backupRoot, name)).catch(() => undefined);
  }
  await fs.cp(path.join(root, "boards"), path.join(backupRoot, "boards"), { recursive: true, force: true }).catch(() => undefined);
  await fs.cp(path.join(root, "files"), path.join(backupRoot, "files"), { recursive: true, force: true }).catch(() => undefined);
  return backupRoot;
}

async function migrateLegacyStores(state) {
  if (storageMode === "local") return state;
  const migration = await readJson(migrationFile, { migratedStores: [], backups: {} });
  const migratedStores = new Set(migration.migratedStores ?? []);
  const backups = migration.backups ?? {};
  const comments = await readJson(commentsFile, { comments: [] });
  const timeline = await readJson(timelineFile, { events: [] });
  const candidates = [];

  if (!migratedStores.has(localCanvasRoot) && (await realpathIfExists(path.join(localCanvasRoot, "state.json")))) {
    candidates.push({ root: localCanvasRoot, label: `local-${safeName(path.basename(path.dirname(localCanvasRoot)))}` });
  }

  const sessionsRoot = path.join(miraHome, "sessions");
  const sessions = await fs.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of sessions) {
    if (!entry.isDirectory()) continue;
    const root = path.join(sessionsRoot, entry.name);
    if (!migratedStores.has(root)) candidates.push({ root, label: entry.name });
  }

  let changed = false;
  for (const candidate of candidates) {
    backups[candidate.root] ??= (await backupMigrationSource(candidate.root, candidate.label)) ?? "";
    if (await mergeLegacyStore(candidate.root, candidate.label, state, comments, timeline)) {
      migratedStores.add(candidate.root);
      changed = true;
    }
  }

  if (changed) {
    if (!state.boards.some((board) => board.id === state.currentBoardId)) {
      state.currentBoardId = state.boards[0]?.id ?? defaultBoardId;
    }
    await writeJson(commentsFile, comments);
    timeline.events = timeline.events.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-1000);
    await writeJson(timelineFile, timeline);
    await writeJson(migrationFile, { migratedStores: [...migratedStores], backups, updatedAt: new Date().toISOString() });
  }

  return state;
}

async function ensureCanvas() {
  await fs.mkdir(dropsRoot, { recursive: true });
  await fs.mkdir(notesRoot, { recursive: true });
  await fs.mkdir(boardsRoot, { recursive: true });
  await writeJson(metaFile, {
    storageModel: storageMode === "local" ? "local" : "global",
    storageMode,
    sourceWorkspaceRoot,
    appRoot,
    createdAt: (await readJson(metaFile, null))?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

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

  state = await migrateLegacyStores(state);

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
  try {
    await fs.access(timelineFile);
  } catch {
    await writeJson(timelineFile, { events: [] });
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

async function readTimeline() {
  await ensureCanvas();
  return readJson(timelineFile, { events: [] });
}

async function recordTimelineEvent(input) {
  const document = await readTimeline();
  const event = {
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...input
  };
  document.events.push(event);
  if (document.events.length > 1000) {
    document.events = document.events.slice(-1000);
  }
  await writeJson(timelineFile, document);
  return event;
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
    throw new Error("This path has not been added to Mira. Import it with mira import or map it with mira link first.");
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

function initialNodePosition(index) {
  return {
    x: 96 + (index % 4) * 72,
    y: 96 + Math.floor(index / 4) * 72
  };
}

function estimateNodeSize(node) {
  if (node?.data?.width && node?.data?.height) {
    return { width: node.data.width, height: node.data.height + 32 };
  }
  if (node?.width && node?.height) {
    return { width: node.width, height: node.height + 32 };
  }
  if (node?.measured?.width && node?.measured?.height) {
    return { width: node.measured.width, height: node.measured.height + 32 };
  }
  const fallback = defaultNodeSizes[node?.data?.sourceType] ?? defaultNodeSizes.file;
  return { width: fallback.width, height: fallback.height + 32 };
}

function sortByPosition(a, b) {
  const rowDelta = a.position.y - b.position.y;
  if (Math.abs(rowDelta) > 80) return rowDelta;
  return a.position.x - b.position.x;
}

function orderedNodesForGroupedLayout(nodes) {
  return [...nodes].sort((a, b) => {
    const typeDelta = (layoutTypeOrder.get(a.data.sourceType) ?? 99) - (layoutTypeOrder.get(b.data.sourceType) ?? 99);
    if (typeDelta) return typeDelta;
    return sortByPosition(a, b);
  });
}

function computeTypeGroups(nodes) {
  const ordered = orderedNodesForGroupedLayout(nodes);
  const groups = [];

  for (const node of ordered) {
    const last = groups.at(-1);
    if (last?.[0]?.data?.sourceType === node.data.sourceType) {
      last.push(node);
    } else {
      groups.push([node]);
    }
  }

  return groups;
}

function measureLayoutRows(rows) {
  return rows.map((row) => {
    const sizes = row.map(estimateNodeSize);
    return {
      width: sizes.reduce((sum, size) => sum + size.width, 0) + Math.max(0, row.length - 1) * arrangeGap,
      height: Math.max(...sizes.map((size) => size.height))
    };
  });
}

function chooseSmartGroupedColumns(nodes) {
  const groups = computeTypeGroups(nodes);
  const ordered = groups.flat();
  if (ordered.length <= 1) return 1;
  const targetRatio = 1.48;
  const maxGroupSize = Math.max(...groups.map((group) => group.length));
  const maxColumns = Math.min(maxGroupSize, Math.max(2, Math.ceil(Math.sqrt(ordered.length)) + 2));
  let best = { columns: 1, score: Number.POSITIVE_INFINITY };

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rows = groups.flatMap((group) => {
      const groupRows = [];
      for (let index = 0; index < group.length; index += columns) {
        groupRows.push(group.slice(index, index + columns));
      }
      return groupRows;
    });
    const rowSizes = measureLayoutRows(rows);
    const width = Math.max(...rowSizes.map((row) => row.width));
    const height = rowSizes.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * arrangeRowGap;
    const ratio = width / Math.max(1, height);
    const emptySlots = groups.reduce((sum, group) => sum + (Math.ceil(group.length / columns) * columns - group.length), 0);
    const score = Math.abs(targetRatio - ratio) + emptySlots * 0.06 + height / 10000;
    if (score < best.score) best = { columns, score };
  }

  return best.columns;
}

function groupedRowsForLayout(nodes) {
  const groups = computeTypeGroups(nodes);
  const columns = chooseSmartGroupedColumns(nodes);
  return groups.flatMap((group) => {
    const rows = [];
    for (let index = 0; index < group.length; index += columns) {
      rows.push(group.slice(index, index + columns));
    }
    return rows;
  });
}

function computeSmartLayout(nodes, origin = { x: 96, y: 96 }) {
  const rows = groupedRowsForLayout(nodes);
  const positions = new Map();
  let cursorY = origin.y;
  const rowSizes = measureLayoutRows(rows);

  for (const [rowIndex, row] of rows.entries()) {
    const rowHeight = rowSizes[rowIndex].height;
    let cursorX = origin.x;
    for (const node of row) {
      const size = estimateNodeSize(node);
      positions.set(node.id, { x: cursorX, y: cursorY });
      cursorX += size.width + arrangeGap;
    }
    cursorY += rowHeight + arrangeRowGap;
  }

  return positions;
}

function nextBatchOrigin(existingNodes) {
  if (!existingNodes.length) return { x: 96, y: 96 };
  const bottom = Math.max(...existingNodes.map((node) => node.position.y + estimateNodeSize(node).height));
  return { x: 96, y: bottom + arrangeRowGap };
}

function applySmartLayout(nodes, origin) {
  const positions = computeSmartLayout(nodes, origin);
  for (const node of nodes) {
    const position = positions.get(node.id);
    if (position) node.position = position;
  }
  return nodes;
}

async function nodeForFile(filePath, index, prefix = "cli") {
  const sourceType = inferSourceType(filePath);
  return {
    id: `${prefix}-${sourceType}-${Date.now()}-${index}`,
    type: sourceType,
    position: initialNodePosition(index),
    data: {
      title: path.basename(filePath),
      path: filePath,
      sourceType,
      summary: filePath,
      asset: await getAssetMetadata(filePath).catch(() => undefined),
      preview: sourceType === "image" || sourceType === "video",
      ...(sourceType === "markdown" || sourceType === "html" ? defaultNodeSizes[sourceType] : {})
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
    nodes.push(await nodeForFile(target, start + index));
  }

  applySmartLayout(nodes, nextBatchOrigin(document.nodes));
  document.nodes.push(...nodes);
  document.edges = document.edges ?? [];
  await writeCanvas(document, args);
  const board = await currentBoard(args);
  await recordTimelineEvent({ type: "file.import", boardId: board.id, text: `Imported ${nodes.length} file${nodes.length === 1 ? "" : "s"}.`, details: { files: nodes.map((node) => node.data.path) } });
  const result = { board, imported: nodes.length, nodes };
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
    nodes.push(await nodeForFile(source, start + index, "cli-add"));
  }

  applySmartLayout(nodes, nextBatchOrigin(document.nodes));
  document.nodes.push(...nodes);
  document.edges = document.edges ?? [];
  await writeCanvas(document, args);
  const board = await currentBoard(args);
  await recordTimelineEvent({ type: "file.add", boardId: board.id, text: `Added ${nodes.length} mapped file${nodes.length === 1 ? "" : "s"}.`, details: { files: nodes.map((node) => node.data.path) } });
  const result = { board, added: nodes.length, nodes };
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
  const node = await nodeForFile(target, document.nodes.length, "cli-note");
  applySmartLayout([node], nextBatchOrigin(document.nodes));
  document.nodes.push(node);
  document.edges = document.edges ?? [];
  await writeCanvas(document, args);
  const board = await currentBoard(args);
  await recordTimelineEvent({ type: "markdown.create", boardId: board.id, path: target, nodeId: node.id, title: node.data.title });
  const result = { board, created: true, node, path: target };
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
  const board = await currentBoard(args);
  await recordTimelineEvent({ type: "file.link", boardId: board.id, path: linkPath, title: path.basename(linkPath), details: { target } });
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

async function removeNodes(args) {
  const json = hasFlag(args, "--json");
  const ids = withoutFlags(args);
  if (!ids.length) throw new Error("Provide at least one node id to remove.");
  const requested = new Set(ids);
  const document = await readCanvas(args);
  const removed = document.nodes.filter((node) => requested.has(node.id));
  if (!removed.length) throw new Error(`No matching nodes found for ${ids.join(", ")}`);
  document.nodes = document.nodes.filter((node) => !requested.has(node.id));
  document.edges = (document.edges ?? []).filter((edge) => !requested.has(edge.source) && !requested.has(edge.target));
  await writeCanvas(document, args);
  const board = await currentBoard(args);
  await recordTimelineEvent({
    type: "node.remove",
    boardId: board.id,
    text: `Removed ${removed.length} node${removed.length === 1 ? "" : "s"}.`,
    details: {
      nodes: removed.map((node) => ({
        id: node.id,
        title: node.data.title,
        path: node.data.path,
        sourceType: node.data.sourceType
      }))
    }
  });
  if (json) return printJson({ board, removed: removed.length, nodes: removed });
  for (const node of removed) console.log(`${node.id}\tremoved\t${node.data.title}`);
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
    await recordTimelineEvent({ type: "board.create", boardId: board.id, title: board.title });
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
    await recordTimelineEvent({ type: "board.use", boardId: board.id, title: board.title });
    if (json) return printJson({ board, boards: state.boards, currentBoardId: state.currentBoardId });
    console.log(`${board.id}\t${board.title}`);
    return;
  }

  if (action === "delete") {
    const [requested] = withoutFlags(rest);
    if (!requested) throw new Error("Provide a board id.");
    if (!hasFlag(rest, "--confirm")) throw new Error("Deleting a board requires --confirm.");
    if (state.boards.length <= 1) throw new Error("Keep at least one board.");

    const boardId = safeBoardId(requested);
    const board = state.boards.find((item) => item.id === boardId);
    if (!board) throw new Error(`No board found for ${requested}`);

    state.boards = state.boards.filter((item) => item.id !== board.id);
    if (state.currentBoardId === board.id) {
      state.currentBoardId = state.boards[0]?.id ?? defaultBoardId;
    }

    await fs.rm(boardFile(board.id), { force: true });
    const comments = await readComments();
    comments.comments = comments.comments.filter((comment) => comment.boardId !== board.id);
    await writeComments(comments);
    await writeJson(stateFile, state);
    await recordTimelineEvent({ type: "board.delete", boardId: board.id, title: board.title });

    if (json) return printJson({ board, boards: state.boards, currentBoardId: state.currentBoardId });
    console.log(`${board.id}\t${board.title}\tdeleted`);
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
    await recordTimelineEvent({ type: "comment.resolve", boardId: comment.boardId, nodeId: comment.nodeId, path: comment.path, title: comment.title, text: comment.comment });
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
    miraHome,
    storageMode,
    sourceWorkspaceRoot,
    workspaceRoot,
    projectRoot,
    canvasRoot,
    boardsRoot,
    filesRoot,
    canvasFile,
    commentsFile,
    timelineFile,
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
    console.log(`home\t${miraHome}`);
    console.log(`source\t${sourceWorkspaceRoot}`);
    console.log(`storage\t${canvasRoot}`);
    console.log(`board\t${board.id}\t${board.title}`);
    console.log(`files\t${filesRoot}`);
    console.log(`service\t${result.serviceUrl}`);
    console.log(`nodes\t${result.nodes}`);
    console.log(`files\t${result.files}`);
  }
}

async function migrateCommand(args) {
  const json = hasFlag(args, "--json");
  await ensureCanvas();
  const state = await readState();
  const migration = await readJson(migrationFile, { migratedStores: [], backups: {} });
  migration.backups ??= {};
  migration.backups.__global_current ??= (await backupMigrationSource(canvasRoot, "current-global")) ?? "";
  migration.updatedAt = new Date().toISOString();
  await writeJson(migrationFile, migration);
  const result = {
    miraHome,
    canvasRoot,
    boards: state.boards,
    migratedStores: migration.migratedStores ?? [],
    backups: migration.backups ?? {}
  };
  if (json) return printJson(result);
  console.log(`home\t${miraHome}`);
  console.log(`storage\t${canvasRoot}`);
  console.log(`boards\t${state.boards.length}`);
  for (const store of result.migratedStores) console.log(`migrated\t${store}`);
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
    const asset = node.data.asset ?? (node.data.path ? await getAssetMetadata(node.data.path).catch(() => null) : null);
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
        asset ? `asset: ${JSON.stringify(asset)}` : "",
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

async function noteCommand(args) {
  const json = hasFlag(args, "--json");
  const text = withoutFlags(args).join(" ").trim();
  if (!text) throw new Error("Provide a note.");
  const board = await currentBoard(args);
  const event = await recordTimelineEvent({ type: "note", boardId: board.id, text });
  if (json) return printJson({ event });
  console.log(`${event.id}\t${event.createdAt}\t${event.text}`);
}

async function timelineCommand(args) {
  const json = hasFlag(args, "--json");
  const limit = Number(getOptionValue(args, "--limit") ?? 50);
  const board = await currentBoard(args);
  const document = await readTimeline();
  const events = document.events.filter((event) => event.boardId === board.id).slice(-limit);
  if (json) return printJson({ board, events });
  for (const event of events) {
    console.log(`${event.createdAt}\t${event.type}\t${event.title ?? event.nodeId ?? event.path ?? ""}\t${event.text ?? ""}`);
  }
}

async function describeCommand(args) {
  const json = hasFlag(args, "--json");
  const [nodeId, ...textParts] = withoutFlags(args);
  const description = textParts.join(" ").trim();
  if (!nodeId) throw new Error("Provide a node id.");
  if (!description) throw new Error("Provide a description.");
  const document = await readCanvas(args);
  const node = document.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`No node found for ${nodeId}`);
  node.data.asset = {
    ...(node.data.path ? await getAssetMetadata(node.data.path).catch(() => ({})) : {}),
    ...node.data.asset,
    description,
    updatedAt: new Date().toISOString()
  };
  await writeCanvas(document, args);
  const board = await currentBoard(args);
  const event = await recordTimelineEvent({ type: "asset.describe", boardId: board.id, nodeId: node.id, path: node.data.path, title: node.data.title, text: description });
  if (json) return printJson({ board, node, event });
  console.log(`${node.id}\t${node.data.title}\t${description}`);
}

async function readCommand(args) {
  const resolved = await assertAllowedPath(args[0]);
  console.log(await fs.readFile(resolved, "utf8"));
}

async function writeCommand(args) {
  const resolved = await assertAllowedPath(args[0]);
  const content = args.slice(1).join(" ");
  await fs.writeFile(resolved, content, "utf8");
  const board = await currentBoard(args);
  await recordTimelineEvent({ type: "file.write", boardId: board.id, path: resolved, title: path.basename(resolved), details: { bytes: Buffer.byteLength(content, "utf8") } });
}

async function serve(args) {
  const portIndex = args.indexOf("--port");
  const port = portIndex >= 0 ? args[portIndex + 1] : "3020";
  const nextBin = path.join(appRoot, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "--port", port], {
    cwd: appRoot,
    env: {
      ...process.env,
      MIRA_HOME: miraHome,
      MIRA_SOURCE_WORKSPACE: sourceWorkspaceRoot,
      MIRA_STORAGE: storageMode,
      CANVAS_WORKSPACE: sourceWorkspaceRoot,
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
  if (command === "migrate") return migrateCommand(args);
  if (command === "board") return boardCommand(args);
  if (command === "comments") return commentsCommand(args);
  if (command === "note") return noteCommand(args);
  if (command === "timeline") return timelineCommand(args);
  if (command === "describe") return describeCommand(args);
  if (command === "list") return listNodes(args);
  if (command === "remove" || command === "rm") return removeNodes(args);
  if (command === "files") return listFiles(args);
  if (command === "import") return importFiles(args);
  if (command === "add") return addFiles(args);
  if (command === "markdown") return createMarkdown(args);
  if (command === "link") return linkPath(args);
  if (command === "context") return contextFor(args);
  if (command === "read") return readCommand(args);
  if (command === "write") return writeCommand(args);

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

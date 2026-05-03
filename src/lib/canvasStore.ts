import { promises as fs } from "fs";
import os from "os";
import path from "path";

export type CanvasNodeData = {
  title: string;
  path?: string;
  content?: string;
  sourceType: "markdown" | "html" | "image" | "video" | "prompt" | "file";
  summary?: string;
  asset?: AssetMetadata;
  width?: number;
  height?: number;
};

export type AssetMetadata = {
  format?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  title?: string;
  words?: number;
  description?: string;
  updatedAt?: string;
};

export type CanvasDocument = {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: CanvasNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
  }>;
};

export type CanvasBoard = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type CanvasState = {
  currentBoardId: string;
  boards: CanvasBoard[];
};

export type CanvasComment = {
  id: string;
  boardId: string;
  nodeId: string;
  path?: string;
  title?: string;
  quote: string;
  comment: string;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
};

export type TimelineEvent = {
  id: string;
  type: string;
  boardId?: string;
  text?: string;
  path?: string;
  nodeId?: string;
  title?: string;
  details?: Record<string, unknown>;
  createdAt: string;
};

function safeStorageName(input: string) {
  return input.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-") || `workspace-${Date.now()}`;
}

export const sourceWorkspaceRoot = path.resolve(process.env.MIRA_SOURCE_WORKSPACE ?? process.env.CANVAS_WORKSPACE ?? process.cwd());
export const workspaceRoot = sourceWorkspaceRoot;
export const projectRoot = sourceWorkspaceRoot;
export const miraHome = path.resolve(process.env.MIRA_HOME ?? path.join(os.homedir(), ".mira"));
export const storageMode = process.env.MIRA_STORAGE ?? "home";
export const localCanvasRoot = path.join(sourceWorkspaceRoot, ".canvas");
export const canvasRoot = storageMode === "local" ? localCanvasRoot : miraHome;
export const filesRoot = path.join(canvasRoot, "files");
export const boardsRoot = path.join(canvasRoot, "boards");
export const metaFile = path.join(canvasRoot, "meta.json");
export const migrationFile = path.join(canvasRoot, "migration.json");
export const backupsRoot = path.join(os.homedir(), ".mira-backups");
export const stateFile = path.join(canvasRoot, "state.json");
export const commentsFile = path.join(canvasRoot, "comments.json");
export const timelineFile = path.join(canvasRoot, "timeline.json");
export const canvasFile = path.join(canvasRoot, "canvas.json");
export const defaultBoardId = "main";

const emptyCanvasDocument: CanvasDocument = { nodes: [], edges: [] };
const emptyCommentsDocument: { comments: CanvasComment[] } = { comments: [] };
const emptyTimelineDocument: { events: TimelineEvent[] } = { events: [] };
const migrationStartedAt = new Date().toISOString().replace(/[:.]/g, "-");

function nowIso() {
  return new Date().toISOString();
}

export function safeBoardId(input: string) {
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

function boardPath(boardId: string) {
  return path.join(boardsRoot, `${safeBoardId(boardId)}.json`);
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function imageSizeFromBuffer(buffer: Buffer, filePath: string) {
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
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
      };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
  }
  return {};
}

function svgSizeFromText(text: string) {
  const width = text.match(/\bwidth=["']?([0-9.]+)/i)?.[1];
  const height = text.match(/\bheight=["']?([0-9.]+)/i)?.[1];
  if (width && height) return { width: Math.round(Number(width)), height: Math.round(Number(height)) };
  const viewBox = text.match(/\bviewBox=["'][^"']*?([0-9.]+)\s+([0-9.]+)["']/i);
  if (viewBox) return { width: Math.round(Number(viewBox[1])), height: Math.round(Number(viewBox[2])) };
  return {};
}

export async function getAssetMetadata(filePath: string): Promise<AssetMetadata> {
  const stat = await fs.stat(filePath);
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const sourceType = inferSourceType(filePath);
  const metadata: AssetMetadata = {
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
    if (ext === "svg") {
      Object.assign(metadata, svgSizeFromText(await fs.readFile(filePath, "utf8").catch(() => "")));
    } else {
      Object.assign(metadata, imageSizeFromBuffer(await fs.readFile(filePath), filePath));
    }
  }

  return metadata;
}

async function readLegacyCanvas() {
  return readJsonFile<CanvasDocument>(canvasFile, emptyCanvasDocument);
}

async function countCanvasNodes(root: string) {
  const state = await readJsonFile<CanvasState | null>(path.join(root, "state.json"), null);
  if (state?.boards?.length) {
    let count = 0;
    for (const board of state.boards) {
      const document = await readJsonFile<CanvasDocument>(path.join(root, "boards", `${safeBoardId(board.id)}.json`), emptyCanvasDocument);
      count += Array.isArray(document.nodes) ? document.nodes.length : 0;
    }
    return count;
  }
  const legacyDocument = await readJsonFile<CanvasDocument>(path.join(root, "canvas.json"), emptyCanvasDocument);
  return Array.isArray(legacyDocument.nodes) ? legacyDocument.nodes.length : 0;
}

function remapPathValue(value: unknown, fromRoot: string, toRoot: string): unknown {
  if (typeof value === "string") {
    if (value === fromRoot || value.startsWith(`${fromRoot}${path.sep}`)) {
      return path.join(toRoot, path.relative(fromRoot, value));
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapPathValue(item, fromRoot, toRoot));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapPathValue(item, fromRoot, toRoot)]));
  }
  return value;
}

function remapBoardIdValue(value: unknown, boardIds: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => remapBoardIdValue(item, boardIds));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (key === "boardId" && typeof item === "string" && boardIds.has(item)) {
          return [key, boardIds.get(item)];
        }
        return [key, remapBoardIdValue(item, boardIds)];
      })
    );
  }
  return value;
}

function uniqueBoardId(baseInput: string, usedIds: Set<string>) {
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

async function mergeLegacyStore(root: string, label: string, state: CanvasState, comments: { comments: CanvasComment[] }, timeline: { events: TimelineEvent[] }) {
  const legacyState = await readJsonFile<CanvasState | null>(path.join(root, "state.json"), null);
  if (!legacyState?.boards?.length) return false;

  const usedIds = new Set(state.boards.map((board) => board.id));
  const boardIds = new Map<string, string>();
  const filesSourceRoot = path.join(root, "files");
  const filesTargetRoot = path.join(filesRoot, "legacy", safeStorageName(label));
  const hasFiles = await realpathIfExists(filesSourceRoot);
  if (hasFiles) {
    await copyLegacyFiles(filesSourceRoot, filesTargetRoot);
  }

  for (const board of legacyState.boards) {
    const document = await readJsonFile<CanvasDocument>(path.join(root, "boards", `${safeBoardId(board.id)}.json`), emptyCanvasDocument);
    const fallbackDocument = board.id === defaultBoardId ? await readJsonFile<CanvasDocument>(path.join(root, "canvas.json"), emptyCanvasDocument) : emptyCanvasDocument;
    const sourceDocument = document.nodes?.length ? document : fallbackDocument;
    const hasContent = Boolean(sourceDocument.nodes?.length || sourceDocument.edges?.length);
    if (!hasContent && board.id === defaultBoardId && usedIds.has(defaultBoardId)) {
      continue;
    }

    const nextId = usedIds.has(board.id) ? uniqueBoardId(`${safeStorageName(label)}-${board.id}`, usedIds) : uniqueBoardId(board.id, usedIds);
    boardIds.set(board.id, nextId);
    const nextTitle = nextId === board.id ? board.title : `${board.title} (${label})`;
    state.boards.push({
      ...board,
      id: nextId,
      title: nextTitle
    });

    const remappedDocument = remapPathValue(sourceDocument, filesSourceRoot, filesTargetRoot) as CanvasDocument;
    await writeJsonFile(boardPath(nextId), remappedDocument);
  }

  if (!boardIds.size) return false;

  const legacyComments = await readJsonFile<{ comments: CanvasComment[] }>(path.join(root, "comments.json"), emptyCommentsDocument);
  const existingCommentIds = new Set(comments.comments.map((comment) => comment.id));
  for (const legacyComment of legacyComments.comments ?? []) {
    if (!boardIds.has(legacyComment.boardId)) continue;
    const remapped = remapBoardIdValue(remapPathValue(legacyComment, filesSourceRoot, filesTargetRoot), boardIds) as CanvasComment;
    if (existingCommentIds.has(remapped.id)) {
      remapped.id = `${safeStorageName(label)}-${remapped.id}`;
    }
    existingCommentIds.add(remapped.id);
    comments.comments.push(remapped);
  }

  const legacyTimeline = await readJsonFile<{ events: TimelineEvent[] }>(path.join(root, "timeline.json"), emptyTimelineDocument);
  const existingEventIds = new Set(timeline.events.map((event) => event.id));
  for (const legacyEvent of legacyTimeline.events ?? []) {
    if (legacyEvent.boardId && !boardIds.has(legacyEvent.boardId)) continue;
    const remapped = remapBoardIdValue(remapPathValue(legacyEvent, filesSourceRoot, filesTargetRoot), boardIds) as TimelineEvent;
    if (existingEventIds.has(remapped.id)) {
      remapped.id = `${safeStorageName(label)}-${remapped.id}`;
    }
    existingEventIds.add(remapped.id);
    timeline.events.push(remapped);
  }

  return true;
}

async function copyLegacyFiles(sourceRoot: string, targetRoot: string) {
  if (sourceRoot === targetRoot || targetRoot.startsWith(`${sourceRoot}${path.sep}`)) {
    return;
  }
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

async function backupMigrationSource(root: string, label: string) {
  if (storageMode === "local") return undefined;
  const backupRoot = path.join(backupsRoot, `global-migration-${migrationStartedAt}`, safeStorageName(label));
  await fs.mkdir(backupRoot, { recursive: true });
  for (const name of ["state.json", "canvas.json", "comments.json", "timeline.json", "meta.json"]) {
    await fs.copyFile(path.join(root, name), path.join(backupRoot, name)).catch(() => undefined);
  }
  await fs.cp(path.join(root, "boards"), path.join(backupRoot, "boards"), { recursive: true, force: true }).catch(() => undefined);
  await fs.cp(path.join(root, "files"), path.join(backupRoot, "files"), { recursive: true, force: true }).catch(() => undefined);
  return backupRoot;
}

async function migrateLegacyStores(state: CanvasState) {
  if (storageMode === "local") return state;
  const migration = await readJsonFile<{ migratedStores?: string[]; backups?: Record<string, string> }>(migrationFile, { migratedStores: [], backups: {} });
  const migratedStores = new Set(migration.migratedStores ?? []);
  const backups = migration.backups ?? {};
  const comments = await readJsonFile<{ comments: CanvasComment[] }>(commentsFile, emptyCommentsDocument);
  const timeline = await readJsonFile<{ events: TimelineEvent[] }>(timelineFile, emptyTimelineDocument);
  const candidates: Array<{ root: string; label: string }> = [];

  if (!migratedStores.has(localCanvasRoot) && (await realpathIfExists(path.join(localCanvasRoot, "state.json")))) {
    candidates.push({ root: localCanvasRoot, label: `local-${safeStorageName(path.basename(path.dirname(localCanvasRoot)))}` });
  }

  const sessionsRoot = path.join(miraHome, "sessions");
  const sessions = await fs.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of sessions) {
    if (!entry.isDirectory()) continue;
    const root = path.join(sessionsRoot, entry.name);
    if (migratedStores.has(root)) continue;
    candidates.push({ root, label: entry.name });
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
    await writeJsonFile(commentsFile, comments);
    timeline.events = timeline.events.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-1000);
    await writeJsonFile(timelineFile, timeline);
    await writeJsonFile(migrationFile, { migratedStores: [...migratedStores], backups, updatedAt: nowIso() });
  }

  return state;
}

export async function ensureCanvasFolders() {
  await fs.mkdir(filesRoot, { recursive: true });
  await fs.mkdir(boardsRoot, { recursive: true });
  const previousMeta = await readJsonFile<{ createdAt?: string } | null>(metaFile, null);
  await writeJsonFile(metaFile, {
    storageModel: storageMode === "local" ? "local" : "global",
    storageMode,
    sourceWorkspaceRoot,
    appRoot: process.cwd(),
    createdAt: previousMeta?.createdAt ?? nowIso(),
    updatedAt: nowIso()
  });

  let state = await readJsonFile<CanvasState | null>(stateFile, null);
  const timestamp = nowIso();

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
      await fs.access(boardPath(board.id));
    } catch {
      const document = board.id === defaultBoardId ? await readLegacyCanvas() : emptyCanvasDocument;
      await writeJsonFile(boardPath(board.id), document);
    }
  }

  try {
    await fs.access(commentsFile);
  } catch {
    await writeJsonFile(commentsFile, emptyCommentsDocument);
  }
  try {
    await fs.access(timelineFile);
  } catch {
    await writeJsonFile(timelineFile, emptyTimelineDocument);
  }

  await writeJsonFile(stateFile, state);
}

export async function readTimeline() {
  await ensureCanvasFolders();
  return readJsonFile<{ events: TimelineEvent[] }>(timelineFile, emptyTimelineDocument);
}

export async function listTimeline(filters: { boardId?: string; limit?: number } = {}) {
  const document = await readTimeline();
  const events = document.events
    .filter((event) => !filters.boardId || event.boardId === safeBoardId(filters.boardId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return typeof filters.limit === "number" && filters.limit > 0 ? events.slice(-filters.limit) : events;
}

export async function recordTimelineEvent(input: Omit<TimelineEvent, "id" | "createdAt">) {
  const document = await readTimeline();
  const event: TimelineEvent = {
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: nowIso(),
    ...input
  };
  document.events.push(event);
  if (document.events.length > 1000) {
    document.events = document.events.slice(-1000);
  }
  await writeJsonFile(timelineFile, document);
  return event;
}

export async function readCanvasState(): Promise<CanvasState> {
  await ensureCanvasFolders();
  return readJsonFile<CanvasState>(stateFile, {
    currentBoardId: defaultBoardId,
    boards: []
  });
}

export async function writeCanvasState(state: CanvasState) {
  await ensureCanvasFolders();
  await writeJsonFile(stateFile, state);
}

export async function getCurrentBoard() {
  const state = await readCanvasState();
  return state.boards.find((board) => board.id === state.currentBoardId) ?? state.boards[0];
}

export async function listBoards() {
  const state = await readCanvasState();
  return {
    boards: state.boards,
    currentBoardId: state.currentBoardId
  };
}

export async function setCurrentBoard(boardId: string) {
  const state = await readCanvasState();
  const normalized = safeBoardId(boardId);
  const board = state.boards.find((item) => item.id === normalized);
  if (!board) {
    throw new Error(`No board found for ${boardId}`);
  }
  state.currentBoardId = board.id;
  await writeJsonFile(stateFile, state);
  await recordTimelineEvent({ type: "board.use", boardId: board.id, title: board.title });
  return board;
}

export async function createBoard(titleInput: string) {
  await ensureCanvasFolders();
  const state = await readCanvasState();
  const title = titleInput.trim() || `Board ${state.boards.length + 1}`;
  const baseId = safeBoardId(title);
  let id = baseId;
  let index = 2;
  while (state.boards.some((board) => board.id === id)) {
    id = `${baseId}-${index}`;
    index += 1;
  }
  const timestamp = nowIso();
  const board: CanvasBoard = {
    id,
    title,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.boards.push(board);
  state.currentBoardId = id;
  await writeJsonFile(boardPath(id), emptyCanvasDocument);
  await writeJsonFile(stateFile, state);
  await recordTimelineEvent({ type: "board.create", boardId: board.id, title: board.title });
  return board;
}

export async function deleteBoard(boardId: string) {
  await ensureCanvasFolders();
  const state = await readCanvasState();
  const normalized = safeBoardId(boardId);
  const board = state.boards.find((item) => item.id === normalized);
  if (!board) {
    throw new Error(`No board found for ${boardId}`);
  }
  if (state.boards.length <= 1) {
    throw new Error("Keep at least one board.");
  }

  state.boards = state.boards.filter((item) => item.id !== board.id);
  if (state.currentBoardId === board.id) {
    state.currentBoardId = state.boards[0]?.id ?? defaultBoardId;
  }

  await fs.rm(boardPath(board.id), { force: true });

  const comments = await readJsonFile<{ comments: CanvasComment[] }>(commentsFile, emptyCommentsDocument);
  comments.comments = comments.comments.filter((comment) => comment.boardId !== board.id);
  await writeJsonFile(commentsFile, comments);

  await writeJsonFile(stateFile, state);
  await recordTimelineEvent({ type: "board.delete", boardId: board.id, title: board.title });
  return board;
}

export async function readCanvas(boardId?: string): Promise<CanvasDocument> {
  await ensureCanvasFolders();
  const state = await readCanvasState();
  const targetBoardId = safeBoardId(boardId ?? state.currentBoardId);
  const board = state.boards.find((item) => item.id === targetBoardId);
  if (!board) {
    throw new Error(`No board found for ${boardId ?? targetBoardId}`);
  }
  return readJsonFile<CanvasDocument>(boardPath(board.id), emptyCanvasDocument);
}

export async function writeCanvas(document: CanvasDocument, boardId?: string) {
  await ensureCanvasFolders();
  const state = await readCanvasState();
  const targetBoardId = safeBoardId(boardId ?? state.currentBoardId);
  const board = state.boards.find((item) => item.id === targetBoardId);
  if (!board) {
    throw new Error(`No board found for ${boardId ?? targetBoardId}`);
  }
  const timestamp = nowIso();
  board.updatedAt = timestamp;
  await writeJsonFile(boardPath(board.id), document);
  await writeJsonFile(stateFile, state);
  return board;
}

export async function readComments() {
  await ensureCanvasFolders();
  return readJsonFile<{ comments: CanvasComment[] }>(commentsFile, emptyCommentsDocument);
}

export async function listComments(filters: { boardId?: string; nodeId?: string; path?: string; status?: CanvasComment["status"] } = {}) {
  const document = await readComments();
  return document.comments.filter((comment) => {
    if (filters.boardId && comment.boardId !== safeBoardId(filters.boardId)) return false;
    if (filters.nodeId && comment.nodeId !== filters.nodeId) return false;
    if (filters.path && comment.path !== filters.path) return false;
    if (filters.status && comment.status !== filters.status) return false;
    return true;
  });
}

export async function createComment(input: {
  boardId?: string;
  nodeId: string;
  path?: string;
  title?: string;
  quote: string;
  comment: string;
}) {
  if (!input.nodeId) {
    throw new Error("Missing node id for comment.");
  }
  if (!input.quote.trim()) {
    throw new Error("Select text before adding a comment.");
  }
  if (!input.comment.trim()) {
    throw new Error("Comment cannot be empty.");
  }
  const state = await readCanvasState();
  const requestedBoardId = input.boardId ? safeBoardId(input.boardId) : state.currentBoardId;
  const board = state.boards.find((item) => item.id === requestedBoardId);
  if (!board) {
    throw new Error(`No board found for ${input.boardId ?? requestedBoardId}`);
  }
  const boardId = board?.id ?? defaultBoardId;
  const document = await readComments();
  const timestamp = nowIso();
  const comment: CanvasComment = {
    id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    boardId,
    nodeId: input.nodeId,
    path: input.path,
    title: input.title,
    quote: input.quote.trim(),
    comment: input.comment.trim(),
    status: "open",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  document.comments.push(comment);
  await writeJsonFile(commentsFile, document);
  await recordTimelineEvent({
    type: "comment.create",
    boardId,
    nodeId: comment.nodeId,
    path: comment.path,
    title: comment.title,
    text: comment.comment,
    details: { quote: comment.quote }
  });
  return comment;
}

export async function resolveComment(commentId: string) {
  const document = await readComments();
  const comment = document.comments.find((item) => item.id === commentId);
  if (!comment) {
    throw new Error(`No comment found for ${commentId}`);
  }
  comment.status = "resolved";
  comment.updatedAt = nowIso();
  await writeJsonFile(commentsFile, document);
  await recordTimelineEvent({ type: "comment.resolve", boardId: comment.boardId, nodeId: comment.nodeId, path: comment.path, title: comment.title, text: comment.comment });
  return comment;
}

export function resolveUserPath(userPath: string) {
  if (!userPath) {
    throw new Error("Missing file path");
  }

  return path.isAbsolute(userPath)
    ? path.normalize(userPath)
    : path.normalize(path.join(projectRoot, userPath));
}

async function realpathIfExists(targetPath: string) {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return null;
  }
}

export async function isAllowedPath(targetPath: string) {
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

export async function assertAllowedPath(targetPath: string) {
  const resolved = resolveUserPath(targetPath);
  if (!(await isAllowedPath(resolved))) {
    throw new Error("This path has not been added to Mira. Import it or map it through a symlink first.");
  }
  return resolved;
}

export function inferSourceType(filePath: string): CanvasNodeData["sourceType"] {
  const ext = path.extname(filePath).toLowerCase();
  if ([".md", ".mdx", ".markdown"].includes(ext)) return "markdown";
  if ([".html", ".htm"].includes(ext)) return "html";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"].includes(ext)) return "image";
  if ([".mp4", ".webm", ".mov", ".m4v"].includes(ext)) return "video";
  return "file";
}

export function isRenderableSourceType(sourceType: CanvasNodeData["sourceType"]) {
  return sourceType === "markdown" || sourceType === "html" || sourceType === "image" || sourceType === "video";
}

export function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const table: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4"
  };

  return table[ext] ?? "application/octet-stream";
}

export async function scanCanvasFiles() {
  await ensureCanvasFolders();
  const found: Array<{
    name: string;
    path: string;
    sourceType: CanvasNodeData["sourceType"];
    linked: boolean;
  }> = [];

  async function walk(currentPath: string, depth: number) {
    if (depth > 3) return;
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const itemPath = path.join(currentPath, entry.name);
      const stat = await fs.lstat(itemPath);
      const linked = stat.isSymbolicLink();
      if (entry.isDirectory() || linked) {
        const real = await realpathIfExists(itemPath);
        const target = real ?? itemPath;
        const targetStat = await fs.stat(target).catch(() => null);
        if (targetStat?.isDirectory()) {
          await walk(itemPath, depth + 1);
          continue;
        }
      }

      found.push({
        name: entry.name,
        path: itemPath,
        sourceType: inferSourceType(itemPath),
        linked
      });
    }
  }

  await walk(filesRoot, 0);
  return found;
}

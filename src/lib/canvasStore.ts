import { promises as fs } from "fs";
import path from "path";

export type CanvasNodeData = {
  title: string;
  path?: string;
  content?: string;
  sourceType: "markdown" | "html" | "image" | "video" | "prompt" | "file";
  summary?: string;
  width?: number;
  height?: number;
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

export const workspaceRoot = path.resolve(process.env.CANVAS_WORKSPACE ?? process.cwd());
export const projectRoot = workspaceRoot;
export const canvasRoot = path.join(workspaceRoot, ".canvas");
export const filesRoot = path.join(canvasRoot, "files");
export const boardsRoot = path.join(canvasRoot, "boards");
export const stateFile = path.join(canvasRoot, "state.json");
export const commentsFile = path.join(canvasRoot, "comments.json");
export const canvasFile = path.join(canvasRoot, "canvas.json");
export const defaultBoardId = "main";

const emptyCanvasDocument: CanvasDocument = { nodes: [], edges: [] };
const emptyCommentsDocument: { comments: CanvasComment[] } = { comments: [] };

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

async function readLegacyCanvas() {
  return readJsonFile<CanvasDocument>(canvasFile, emptyCanvasDocument);
}

export async function ensureCanvasFolders() {
  await fs.mkdir(filesRoot, { recursive: true });
  await fs.mkdir(boardsRoot, { recursive: true });

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

  await writeJsonFile(stateFile, state);
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
    throw new Error("This path has not been added to the canvas directory. Import it through a symlink first.");
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

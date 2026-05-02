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

export const workspaceRoot = path.resolve(process.env.CANVAS_WORKSPACE ?? process.cwd());
export const projectRoot = workspaceRoot;
export const canvasRoot = path.join(workspaceRoot, ".canvas");
export const filesRoot = path.join(canvasRoot, "files");
export const canvasFile = path.join(canvasRoot, "canvas.json");

export async function ensureCanvasFolders() {
  await fs.mkdir(filesRoot, { recursive: true });
  try {
    await fs.access(canvasFile);
  } catch {
    await fs.writeFile(canvasFile, `${JSON.stringify({ nodes: [], edges: [] }, null, 2)}\n`, "utf8");
  }
}

export async function readCanvas(): Promise<CanvasDocument> {
  await ensureCanvasFolders();
  const raw = await fs.readFile(canvasFile, "utf8");
  return JSON.parse(raw) as CanvasDocument;
}

export async function writeCanvas(document: CanvasDocument) {
  await ensureCanvasFolders();
  await fs.writeFile(canvasFile, `${JSON.stringify(document, null, 2)}\n`, "utf8");
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

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
const canvasFile = path.join(canvasRoot, "canvas.json");
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

function hasFlag(args, flag) {
  return args.includes(flag);
}

function withoutFlags(args) {
  return args.filter((arg) => !arg.startsWith("--"));
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
  try {
    await fs.access(canvasFile);
  } catch {
    await fs.writeFile(canvasFile, `${JSON.stringify({ nodes: [], edges: [] }, null, 2)}\n`, "utf8");
  }
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

async function readCanvas() {
  await ensureCanvas();
  return JSON.parse(await fs.readFile(canvasFile, "utf8"));
}

async function writeCanvas(document) {
  await ensureCanvas();
  await fs.writeFile(canvasFile, `${JSON.stringify(document, null, 2)}\n`, "utf8");
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
  const document = await readCanvas();
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
  await writeCanvas(document);
  const result = { imported: nodes.length, nodes };
  if (json) printJson(result);
  else {
    for (const node of nodes) console.log(`${node.id}\t${node.data.sourceType}\t${node.data.path}`);
  }
}

async function addFiles(args) {
  const json = hasFlag(args, "--json");
  const paths = withoutFlags(args);
  if (!paths.length) throw new Error("Provide at least one file path to add to the canvas.");
  const document = await readCanvas();
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
  await writeCanvas(document);
  const result = { added: nodes.length, nodes };
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
  const document = await readCanvas();
  const node = nodeForFile(target, document.nodes.length, "cli-note");
  document.nodes.push(node);
  document.edges = document.edges ?? [];
  await writeCanvas(document);
  const result = { created: true, node, path: target };
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
  const document = await readCanvas();
  if (json) return printJson({ nodes: document.nodes });
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

async function status(args) {
  const json = hasFlag(args, "--json");
  const document = await readCanvas();
  const files = await scanFiles();
  const result = {
    appRoot,
    workspaceRoot,
    projectRoot,
    canvasRoot,
    filesRoot,
    canvasFile,
    serviceUrl: "http://localhost:3020",
    nodes: document.nodes.length,
    files: files.length
  };
  if (json) printJson(result);
  else {
    console.log(`app\t${appRoot}`);
    console.log(`workspace\t${workspaceRoot}`);
    console.log(`canvas\t${canvasRoot}`);
    console.log(`files\t${filesRoot}`);
    console.log(`service\t${result.serviceUrl}`);
    console.log(`nodes\t${result.nodes}`);
    console.log(`files\t${result.files}`);
  }
}

async function contextFor(id) {
  if (!id) throw new Error("Provide a node id.");
  const document = await readCanvas();
  const targets = id === "all" ? document.nodes : document.nodes.filter((item) => item.id === id);
  if (!targets.length) throw new Error(`No node found for ${id}`);
  for (const node of targets) {
    let content = node.data.content ?? "";
    if (!content && node.data.path && ["markdown", "html", "file"].includes(node.data.sourceType)) {
      content = await fs.readFile(node.data.path, "utf8").catch(() => "");
    }
    console.log(
      [
        "# Canvas Context",
        "",
        `node_id: ${node.id}`,
        `type: ${node.data.sourceType}`,
        `title: ${node.data.title}`,
        node.data.path ? `path: ${node.data.path}` : "",
        node.data.summary ? `summary: ${node.data.summary}` : "",
        "",
        "## Content",
        content || "(This node mainly provides a media path or canvas metadata.)"
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
  if (command === "list") return listNodes(args);
  if (command === "files") return listFiles(args);
  if (command === "import") return importFiles(args);
  if (command === "add") return addFiles(args);
  if (command === "markdown") return createMarkdown(args);
  if (command === "link") return linkPath(args);
  if (command === "context") return contextFor(args[0]);
  if (command === "read") return console.log(await fs.readFile(await assertAllowedPath(args[0]), "utf8"));
  if (command === "write") return fs.writeFile(await assertAllowedPath(args[0]), args.slice(1).join(" "), "utf8");

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

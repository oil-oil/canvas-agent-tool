import path from "path";
import chokidar, { type FSWatcher } from "chokidar";
import { boardsRoot, canvasRoot, commentsFile, filesRoot, stateFile, timelineFile } from "./canvasStore";

export type MiraEvent = {
  type: "storage.changed";
  path?: string;
  boardId?: string;
  reason?: string;
  createdAt: string;
};

type Client = ReadableStreamDefaultController<Uint8Array>;

const encoder = new TextEncoder();
const globalKey = "__mira_events__";

type MiraEventsGlobal = {
  clients: Set<Client>;
  watcher?: FSWatcher;
  timer?: ReturnType<typeof setTimeout>;
  queuedEvent?: MiraEvent;
};

function getState(): MiraEventsGlobal {
  const globalStore = globalThis as typeof globalThis & { [globalKey]?: MiraEventsGlobal };
  globalStore[globalKey] ??= {
    clients: new Set<Client>()
  };
  return globalStore[globalKey];
}

function inferBoardId(filePath?: string) {
  if (!filePath) return undefined;
  const relative = path.relative(boardsRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return path.extname(relative) === ".json" ? path.basename(relative, ".json") : undefined;
}

function send(controller: Client, event: MiraEvent) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

export function addMiraEventClient(controller: Client) {
  const state = getState();
  state.clients.add(controller);
  send(controller, { type: "storage.changed", reason: "connected", createdAt: new Date().toISOString() });
  return () => state.clients.delete(controller);
}

export function notifyMiraChange(event: Partial<MiraEvent> = {}) {
  const state = getState();
  state.queuedEvent = {
    type: "storage.changed",
    createdAt: new Date().toISOString(),
    ...event
  };

  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    const nextEvent = state.queuedEvent ?? { type: "storage.changed", createdAt: new Date().toISOString() };
    state.queuedEvent = undefined;
    for (const client of state.clients) {
      try {
        send(client, nextEvent);
      } catch {
        state.clients.delete(client);
      }
    }
  }, 120);
}

export function startMiraWatcher() {
  const state = getState();
  if (state.watcher) return;

  state.watcher = chokidar.watch([stateFile, commentsFile, timelineFile, boardsRoot, filesRoot], {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 180,
      pollInterval: 40
    },
    ignored: (filePath) => {
      const basename = path.basename(String(filePath));
      return basename.startsWith(".") && String(filePath) !== canvasRoot;
    }
  });

  state.watcher.on("all", (_eventName, changedPath) => {
    notifyMiraChange({
      path: changedPath,
      boardId: inferBoardId(changedPath),
      reason: "file-watch"
    });
  });
}

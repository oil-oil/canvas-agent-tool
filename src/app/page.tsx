"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useOnViewportChange,
  useReactFlow,
  useNodesState,
  type Edge,
  type NodeChange
} from "@xyflow/react";
import { AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, ChevronDown, Clipboard, Layers3, LayoutGrid, Monitor, Scan, Smartphone, Tablet, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { writeClipboardPayload } from "../features/canvas/clipboard";
import { CanvasToolbar } from "../features/canvas/components/CanvasToolbar";
import { InspectorHost } from "../features/canvas/components/InspectorHost";
import { nodeTypes } from "../features/canvas/components/nodes";
import { SelectionActionsContext } from "../features/canvas/components/selectionActionsContext";
import { arrangeGap, defaultNodeSizes, emptyEdges, snapGrid, viewportPresets, type ViewportPreset } from "../features/canvas/constants";
import { createMarkdownFile, isSupportedFile, rawUrl, readText, uploadCanvasFiles } from "../features/canvas/fileApi";
import { escapeHtmlAttribute, escapeHtmlText } from "../features/canvas/html";
import { computeSmartLayout, estimateNodeSize, normalizeStoredNode, sizeNode, snapshotNodes, stripRuntimeData } from "../features/canvas/layout";
import type { CanvasBoard, CanvasDocument, CanvasNode, CanvasNodeData, SelectionActions, UploadedFile } from "../features/canvas/types";

const visibleBoardStorageKey = "mira.visibleBoardId";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function CanvasApp() {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<CanvasNode>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [boards, setBoards] = useState<CanvasBoard[]>([]);
  const [currentBoardId, setCurrentBoardId] = useState("main");
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [confirmingBoardId, setConfirmingBoardId] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading canvas");
  const [canvasFolderPath, setCanvasFolderPath] = useState(".canvas");
  const [dragActive, setDragActive] = useState(false);
  const [nodeDragging, setNodeDragging] = useState(false);
  const [wheelOwner, setWheelOwner] = useState<"canvas" | "content" | null>(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [viewportZoom, setViewportZoom] = useState(0.46);
  const [toast, setToast] = useState("");
  const canvasAreaRef = useRef<HTMLElement | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const selectedIdsRef = useRef<string[]>([]);
  const inspectorNodeIdRef = useRef<string | null>(null);
  const boardMenuOpenRef = useRef(boardMenuOpen);
  const nodeDraggingRef = useRef(nodeDragging);
  const undoStackRef = useRef<CanvasNode[][]>([]);
  const redoStackRef = useRef<CanvasNode[][]>([]);
  const boardSwitcherRef = useRef<HTMLElement | null>(null);
  const wheelOwnerRef = useRef<"canvas" | "content" | null>(null);
  const wheelResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCopyShortcutRef = useRef(0);
  const currentBoardIdRef = useRef(currentBoardId);
  const currentBoardUpdatedAtRef = useRef<string | null>(null);
  const isSwitchingBoardRef = useRef(false);
  const { screenToFlowPosition, flowToScreenPosition, getZoom, setCenter, fitView } = useReactFlow<CanvasNode, Edge>();

  useOnViewportChange({
    onChange: (viewport) => {
      setViewportVersion((version) => version + 1);
      setViewportZoom(viewport.zoom);
    },
    onEnd: (viewport) => {
      setViewportVersion((version) => version + 1);
      setViewportZoom(viewport.zoom);
    }
  });

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    inspectorNodeIdRef.current = inspectorNodeId;
  }, [inspectorNodeId]);

  useEffect(() => {
    currentBoardIdRef.current = currentBoardId;
  }, [currentBoardId]);

  useEffect(() => {
    boardMenuOpenRef.current = boardMenuOpen;
  }, [boardMenuOpen]);

  useEffect(() => {
    if (!boardMenuOpen) setConfirmingBoardId(null);
  }, [boardMenuOpen]);

  useEffect(() => {
    nodeDraggingRef.current = nodeDragging;
  }, [nodeDragging]);

  const notify = useCallback((message: string) => {
    setStatus(message);
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 1600);
  }, []);

  const getSelectedNodes = useCallback(() => {
    const selected = new Set(selectedIds);
    return nodesRef.current.filter((node) => selected.has(node.id));
  }, [selectedIds]);

  const inspectorNode = useMemo(() => nodes.find((node) => node.id === inspectorNodeId) ?? null, [inspectorNodeId, nodes]);
  const currentBoard = useMemo(() => boards.find((board) => board.id === currentBoardId) ?? null, [boards, currentBoardId]);
  const selectionToolbarStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!selectedIds.length) return undefined;
    const selected = new Set(selectedIds);
    const selectedNodes = nodes.filter((node) => selected.has(node.id));
    if (!selectedNodes.length) return undefined;
    const rect = canvasAreaRef.current?.getBoundingClientRect();
    if (!rect) return undefined;

    const left = Math.min(...selectedNodes.map((node) => node.position.x));
    const right = Math.max(...selectedNodes.map((node) => node.position.x + estimateNodeSize(node).width));
    const top = Math.min(...selectedNodes.map((node) => node.position.y));
    const screen = flowToScreenPosition({ x: (left + right) / 2, y: top });

    return {
      left: `${screen.x - rect.left}px`,
      top: `${screen.y - rect.top}px`
    };
  }, [flowToScreenPosition, nodes, selectedIds, viewportVersion]);
  const canvasAreaStyle = useMemo(
    () =>
      ({
        "--caption-scale": String(clamp(1 / Math.max(viewportZoom, 0.2), 1, 2.6))
      }) as React.CSSProperties,
    [viewportZoom]
  );

  useEffect(() => {
    if (inspectorNodeId && !inspectorNode) {
      setInspectorNodeId(null);
    }
  }, [inspectorNode, inspectorNodeId]);

  const persistCanvas = useCallback(
    async (nextNodes = nodesRef.current) => {
      const response = await fetch(`/api/canvas?board=${encodeURIComponent(currentBoardIdRef.current)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodes: stripRuntimeData(nextNodes), edges: [] })
      });
      const payload: { board?: CanvasBoard; error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Canvas save failed");
      if (payload.board) {
        currentBoardUpdatedAtRef.current = payload.board.updatedAt;
        setBoards((items) => items.map((board) => (board.id === payload.board?.id ? payload.board : board)));
      }
      setStatus("Canvas saved");
    },
    []
  );

  const pushHistory = useCallback((items = nodesRef.current) => {
    const snapshot = snapshotNodes(items);
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > 80) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, []);

  const updateNode = useCallback(
    (id: string, patch: Partial<CanvasNodeData>) => {
      setNodes((items) => items.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)));
    },
    [setNodes]
  );

  const resizeNode = useCallback(
    (id: string, size: { width: number; height: number }, options?: { persist?: boolean }) => {
      setNodes((items) => {
        let changed = false;
        const next = items.map((node) => {
          if (node.id !== id) return node;
          if (node.data.width === size.width && node.data.height === size.height && node.width === size.width && node.height === size.height) return node;
          changed = true;
          return sizeNode(node, size);
        });
        if (changed && options?.persist) {
          void persistCanvas(next);
        }
        return changed ? next : items;
      });
    },
    [persistCanvas, setNodes]
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((items) => {
        pushHistory(items);
        const next = items.filter((node) => node.id !== id);
        void persistCanvas(next);
        return next;
      });
    },
    [persistCanvas, pushHistory, setNodes]
  );

  const duplicateNode = useCallback(
    (id: string) => {
      setNodes((items) => {
        const source = items.find((node) => node.id === id);
        if (!source) return items;
        pushHistory(items);
        const duplicate = {
          ...source,
          id: `${source.id}-${Date.now()}`,
          selected: false,
          position: {
            x: source.position.x + 48,
            y: source.position.y + 48
          },
          data: { ...source.data }
        };
        const next = items.concat(duplicate);
        void persistCanvas(next);
        return next;
      });
    },
    [persistCanvas, pushHistory, setNodes]
  );

  const copyNodeContext = useCallback(
    async (id: string) => {
      const node = nodesRef.current.find((item) => item.id === id);
      if (!node) return;
      let content = node.data.content ?? "";
      if (!content && node.data.path && ["markdown", "html", "file"].includes(node.data.sourceType)) {
        content = await readText(node.data.path).catch(() => "");
      }
      const context = [
        "# Canvas Context",
        "",
        `node_id: ${node.id}`,
        `type: ${node.data.sourceType}`,
        `title: ${node.data.title}`,
        node.data.path ? `path: ${node.data.path}` : "",
        node.data.summary ? `summary: ${node.data.summary}` : "",
        node.data.asset ? `asset: ${JSON.stringify(node.data.asset)}` : "",
        "",
        "## Content",
        content || "(This node mainly provides a media path or canvas metadata.)"
      ]
        .filter(Boolean)
        .join("\n");

      await navigator.clipboard.writeText(context);
      setStatus("Context copied");
    },
    []
  );

  const getNodeContent = useCallback(async (node: CanvasNode) => {
    if (node.data.sourceType === "prompt") {
      return node.data.content ?? "";
    }

    if (node.data.path && ["markdown", "html", "file"].includes(node.data.sourceType)) {
      return readText(node.data.path).catch(() => node.data.content ?? "");
    }

    return node.data.path ?? "";
  }, []);

  const getNodeClipboardPayload = useCallback(
    async (node: CanvasNode) => {
      const title = escapeHtmlAttribute(node.data.title);
      const src = rawUrl(node.data.path);

      if (node.data.sourceType === "image" && node.data.path) {
        return {
          plain: `![${node.data.title}](${src})`,
          html: `<p><img src="${src}" alt="${title}"></p>`
        };
      }

      if (node.data.sourceType === "video" && node.data.path) {
        const html = `<video src="${src}" title="${title}" controls></video>`;
        return {
          plain: html,
          html
        };
      }

      const plain = await getNodeContent(node);
      return {
        plain,
        html: node.data.sourceType === "html" ? plain : `<pre>${escapeHtmlText(plain)}</pre>`
      };
    },
    [getNodeContent]
  );

  const copyNodeContent = useCallback(
    async (id: string) => {
      const node = nodesRef.current.find((item) => item.id === id);
      if (!node) return;
      await writeClipboardPayload(await getNodeClipboardPayload(node));
      setStatus("Content copied");
    },
    [getNodeClipboardPayload]
  );

  const copyNodePath = useCallback(async (id: string) => {
    const node = nodesRef.current.find((item) => item.id === id);
    if (!node) return;
    await navigator.clipboard.writeText(node.data.path ?? "");
    setStatus("Path copied");
  }, []);

  const attachRuntime = useCallback(
    (items: CanvasNode[]) =>
      items.map((node) => {
        const normalized = normalizeStoredNode(node);
        return {
          ...normalized,
          data: {
            ...normalized.data,
            onUpdate: updateNode,
            onResize: resizeNode,
            onDelete: deleteNode,
            onDuplicate: duplicateNode,
            onCopyContext: copyNodeContext,
            onCopyContent: copyNodeContent,
            onCopyPath: copyNodePath,
            onHistory: pushHistory
          }
        };
      }),
    [copyNodeContent, copyNodeContext, copyNodePath, deleteNode, duplicateNode, pushHistory, resizeNode, updateNode]
  );

  const restoreHistory = useCallback(
    (direction: "undo" | "redo") => {
      const from = direction === "undo" ? undoStackRef.current : redoStackRef.current;
      const to = direction === "undo" ? redoStackRef.current : undoStackRef.current;
      const snapshot = from.pop();
      if (!snapshot) {
        setStatus(direction === "undo" ? "Nothing to undo" : "Nothing to redo");
        return;
      }
      to.push(snapshotNodes(nodesRef.current));
      const restored = attachRuntime(snapshot);
      nodesRef.current = restored;
      setNodes(restored);
      setSelectedIds([]);
      setInspectorNodeId(null);
      void persistCanvas(restored);
      setStatus(direction === "undo" ? "Undone" : "Redone");
    },
    [attachRuntime, persistCanvas, setNodes]
  );

  const loadBoards = useCallback(async () => {
    const response = await fetch("/api/boards");
    const payload: { boards?: CanvasBoard[]; currentBoardId?: string } = await response.json();
    const nextBoards = payload.boards ?? [];
    setBoards(nextBoards);
    const storedBoardId = window.localStorage.getItem(visibleBoardStorageKey);
    const nextBoardId = nextBoards.find((board) => board.id === storedBoardId)?.id ?? nextBoards.find((board) => board.id === currentBoardIdRef.current)?.id ?? nextBoards[0]?.id ?? "main";
    const activeBoard = nextBoards.find((board) => board.id === nextBoardId);
    currentBoardUpdatedAtRef.current = activeBoard?.updatedAt ?? null;
    currentBoardIdRef.current = nextBoardId;
    setCurrentBoardId(nextBoardId);
    return nextBoardId;
  }, []);

  const loadCanvas = useCallback(
    async (boardId: string, options?: { silent?: boolean; preserveSelection?: boolean }) => {
      if (!options?.silent) setStatus("Loading board");
      const response = await fetch(`/api/canvas?board=${encodeURIComponent(boardId)}`);
      const document: CanvasDocument = await response.json();
      const nextNodes = attachRuntime(document.nodes ?? []);
      setNodes(nextNodes);
      undoStackRef.current = [];
      redoStackRef.current = [];
      if (options?.preserveSelection) {
        const availableIds = new Set(nextNodes.map((node) => node.id));
        const nextSelectedIds = selectedIdsRef.current.filter((id) => availableIds.has(id));
        setSelectedIds(nextSelectedIds);
        if (inspectorNodeIdRef.current && !availableIds.has(inspectorNodeIdRef.current)) {
          setInspectorNodeId(null);
        }
      } else {
        setSelectedIds([]);
        setInspectorNodeId(null);
      }
      if (!options?.silent) setStatus("Board ready");
    },
    [attachRuntime, setNodes]
  );

  useEffect(() => {
    fetch("/api/status")
      .then((response) => response.json())
      .then((payload: { canvasRoot?: string }) => setCanvasFolderPath(payload.canvasRoot ?? ".canvas"))
      .catch(() => setCanvasFolderPath(".canvas"));

    loadBoards()
      .then((boardId) => loadCanvas(boardId))
      .catch((error) => setStatus(error.message));
  }, [loadBoards, loadCanvas]);

  useEffect(() => {
    let syncTimer: number | null = null;

    async function syncFromServer(event?: { reason?: string; boardId?: string }) {
      if (boardMenuOpenRef.current || isSwitchingBoardRef.current || nodeDraggingRef.current) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest(".content-inspector, .tiptap-body, textarea, input, [contenteditable='true']")) return;

      try {
        const response = await fetch("/api/boards");
        const payload: { boards?: CanvasBoard[]; currentBoardId?: string } = await response.json();
        const nextBoards = payload.boards ?? [];
        setBoards(nextBoards);
        const visibleBoard = nextBoards.find((board) => board.id === currentBoardIdRef.current);

        if (!visibleBoard) {
          const fallbackBoard = nextBoards[0];
          if (!fallbackBoard) return;
          currentBoardIdRef.current = fallbackBoard.id;
          window.localStorage.setItem(visibleBoardStorageKey, fallbackBoard.id);
          setCurrentBoardId(fallbackBoard.id);
          currentBoardUpdatedAtRef.current = fallbackBoard.updatedAt;
          await loadCanvas(fallbackBoard.id, { silent: true });
          notify(`Opened ${fallbackBoard.title}`);
          return;
        }

        const changedVisibleBoard = event?.boardId === visibleBoard.id;
        if (changedVisibleBoard || (visibleBoard.updatedAt && visibleBoard.updatedAt !== currentBoardUpdatedAtRef.current)) {
          currentBoardUpdatedAtRef.current = visibleBoard.updatedAt;
          await loadCanvas(visibleBoard.id, { silent: true, preserveSelection: true });
          notify(event?.reason === "node.remove" ? "Node removed" : "Canvas synced");
        }
      } catch {
        // EventSource will reconnect; manual actions still surface errors.
      }
    }

    function scheduleSync(event?: { reason?: string; boardId?: string }) {
      if (syncTimer) window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => void syncFromServer(event), 140);
    }

    const events = new EventSource("/api/events");
    events.onmessage = (event) => {
      const payload = JSON.parse(event.data || "{}") as { reason?: string; boardId?: string };
      if (payload.reason === "connected") return;
      scheduleSync(payload);
    };

    const handleFocus = () => scheduleSync({ reason: "Canvas synced" });
    window.addEventListener("focus", handleFocus);
    return () => {
      events.close();
      window.removeEventListener("focus", handleFocus);
      if (syncTimer) window.clearTimeout(syncTimer);
    };
  }, [loadCanvas, notify]);

  const switchBoard = useCallback(
    async (boardId: string) => {
      if (boardId === currentBoardIdRef.current) {
        setBoardMenuOpen(false);
        return;
      }

      const targetBoard = boards.find((board) => board.id === boardId);
      isSwitchingBoardRef.current = true;
      setBoardMenuOpen(false);
      setStatus("Loading board");
      currentBoardIdRef.current = boardId;
      currentBoardUpdatedAtRef.current = targetBoard?.updatedAt ?? null;
      setCurrentBoardId(boardId);
      window.localStorage.setItem(visibleBoardStorageKey, boardId);

      try {
        await loadCanvas(boardId, { silent: true });
        setStatus("Board ready");
        notify(`Opened ${targetBoard?.title ?? boardId}`);
      } catch (error) {
        setStatus((error as Error).message);
      } finally {
        isSwitchingBoardRef.current = false;
      }
    },
    [boards, loadCanvas, notify]
  );

  const deleteBoard = useCallback(
    async (boardId: string) => {
      const targetBoard = boards.find((board) => board.id === boardId);
      if (!targetBoard || boards.length <= 1) return;

      setStatus("Deleting board");
      try {
        const response = await fetch("/api/boards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "delete", boardId })
        });
        const payload: { boards?: CanvasBoard[]; error?: string } = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not delete board");

        const nextBoards = payload.boards ?? boards.filter((board) => board.id !== boardId);
        const currentVisibleBoard = nextBoards.find((board) => board.id === currentBoardIdRef.current);
        const nextBoardId = currentVisibleBoard?.id ?? nextBoards[0]?.id ?? "main";
        const activeBoard = nextBoards.find((board) => board.id === nextBoardId);
        setBoards(nextBoards);
        setConfirmingBoardId(null);
        setBoardMenuOpen(false);
        currentBoardIdRef.current = nextBoardId;
        currentBoardUpdatedAtRef.current = activeBoard?.updatedAt ?? null;
        setCurrentBoardId(nextBoardId);
        window.localStorage.setItem(visibleBoardStorageKey, nextBoardId);
        await loadCanvas(nextBoardId, { silent: true });
        notify(`Deleted ${targetBoard.title}`);
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [boards, loadCanvas, notify]
  );

  useEffect(() => {
    if (!boardMenuOpen) return;

    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && boardSwitcherRef.current?.contains(target)) return;
      setBoardMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [boardMenuOpen]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      onNodesChangeBase(changes);
    },
    [onNodesChangeBase]
  );

  const addImportedFiles = useCallback(
    (files: UploadedFile[], position: { x: number; y: number }, options?: { openFirst?: boolean }) => {
      if (!files.length) return;
      const timestamp = Date.now();
      const importedNodes: CanvasNode[] = files.map((file, index) => ({
        id: `drop-${file.sourceType}-${timestamp}-${index}`,
        type: file.sourceType,
        position: {
          x: position.x + (index % 4) * 72,
          y: position.y + Math.floor(index / 4) * 72
        },
        data: {
          title: file.title,
          path: file.path,
          sourceType: file.sourceType,
          summary: file.path,
          asset: file.asset,
          preview: file.sourceType === "image" || file.sourceType === "video",
          ...(file.sourceType === "markdown" || file.sourceType === "html" ? defaultNodeSizes[file.sourceType] : {}),
          onUpdate: updateNode,
          onResize: resizeNode,
          onDelete: deleteNode,
          onDuplicate: duplicateNode,
          onCopyContext: copyNodeContext,
          onCopyContent: copyNodeContent,
          onCopyPath: copyNodePath,
          onHistory: pushHistory
        }
      })).map(normalizeStoredNode);
      const importedPositions = computeSmartLayout(importedNodes, position);
      const arrangedNodes = importedNodes.map((node) => {
        const nextPosition = importedPositions.get(node.id);
        return nextPosition ? { ...node, position: nextPosition } : node;
      });
      setNodes((items) => {
        pushHistory(items);
        const next = items.concat(arrangedNodes);
        void persistCanvas(next);
        return next;
      });
      if (options?.openFirst) {
        setInspectorNodeId(arrangedNodes[0].id);
        setSelectedIds([arrangedNodes[0].id]);
      }
      setStatus(`Imported ${files.length} file${files.length === 1 ? "" : "s"}`);
    },
    [copyNodeContent, copyNodeContext, copyNodePath, deleteNode, duplicateNode, persistCanvas, pushHistory, resizeNode, setNodes, updateNode]
  );

  const uploadDroppedFiles = useCallback(
    async (fileList: FileList, position: { x: number; y: number }) => {
      setStatus("Importing files");
      const uploaded = await uploadCanvasFiles(fileList);
      addImportedFiles(uploaded, position);
    },
    [addImportedFiles]
  );

  const getInsertPosition = useCallback(
    () =>
      screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2
      }),
    [screenToFlowPosition]
  );

  const addFilesFromToolbar = useCallback(
    async (fileList: FileList) => {
      setStatus("Importing files");
      try {
        const uploaded = await uploadCanvasFiles(fileList);
        addImportedFiles(uploaded, getInsertPosition());
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [addImportedFiles, getInsertPosition]
  );

  const addMarkdownFromToolbar = useCallback(async () => {
    setStatus("Creating Markdown");
    try {
      const file = await createMarkdownFile();
      addImportedFiles([file], getInsertPosition(), { openFirst: true });
      setStatus("Markdown created");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }, [addImportedFiles, getInsertPosition]);

  const arrangeSelected = useCallback(() => {
    const selectedNodes = getSelectedNodes();
    if (selectedNodes.length < 2) return;
    const selected = new Set(selectedIds);
    const positions = computeSmartLayout(selectedNodes);

    setNodes((items) => {
      pushHistory(items);
      const next = items.map((node) => {
        if (!selected.has(node.id)) return node;
        const position = positions.get(node.id);
        if (!position) return node;
        return {
          ...node,
          position
        };
      });
      void persistCanvas(next);
      return next;
    });
    notify("Selection arranged");
  }, [getSelectedNodes, notify, persistCanvas, pushHistory, selectedIds, setNodes]);

  const alignSelected = useCallback(
    (axis: "x" | "y") => {
      const selectedNodes = getSelectedNodes();
      if (selectedNodes.length < 2) return;
      const ordered = axis === "y" ? [...selectedNodes].sort((a, b) => a.position.x - b.position.x) : [...selectedNodes].sort((a, b) => a.position.y - b.position.y);
      const anchor = ordered[0];
      const positions = new Map<string, { x: number; y: number }>();
      let cursor = axis === "y" ? anchor.position.x : anchor.position.y;

      for (const node of ordered) {
        const size = estimateNodeSize(node);
        positions.set(node.id, {
          x: axis === "y" ? cursor : anchor.position.x,
          y: axis === "y" ? anchor.position.y : cursor
        });
        cursor += (axis === "y" ? size.width : size.height) + arrangeGap;
      }

      setNodes((items) => {
        pushHistory(items);
        const selected = new Set(selectedIds);
        const next = items.map((node) => {
          if (!selected.has(node.id)) return node;
          const position = positions.get(node.id);
          return position ? { ...node, position } : node;
        });
        void persistCanvas(next);
        return next;
      });
      notify(axis === "y" ? "Selection spaced horizontally" : "Selection spaced vertically");
    },
    [getSelectedNodes, notify, persistCanvas, pushHistory, selectedIds, setNodes]
  );

  const measureNodeContent = useCallback(
    (node: CanvasNode) => {
      const zoom = getZoom() || 1;
      const nodeElement = Array.from(canvasAreaRef.current?.querySelectorAll<HTMLElement>(".react-flow__node") ?? []).find((element) => element.dataset.id === node.id);
      const fallback = estimateNodeSize(node);
      const frameWidth = node.data.width ?? node.width ?? node.measured?.width ?? fallback.width;
      const frameHeight = node.data.height ?? node.height ?? node.measured?.height ?? Math.max(1, fallback.height - 32);

      if (node.data.sourceType === "image") {
        const image = nodeElement?.querySelector<HTMLImageElement>(".media-image");
        const naturalWidth = image?.naturalWidth ?? 0;
        const naturalHeight = image?.naturalHeight ?? 0;
        if (naturalWidth > 0 && naturalHeight > 0) {
          const scale = Math.min(frameWidth / naturalWidth, frameHeight / naturalHeight, 1);
          return {
            width: Math.round(clamp(naturalWidth * scale, 120, 1600)),
            height: Math.round(clamp(naturalHeight * scale, 92, 1400))
          };
        }
      }

      if (node.data.sourceType === "video") {
        const video = nodeElement?.querySelector<HTMLVideoElement>(".media-video");
        const naturalWidth = video?.videoWidth ?? 0;
        const naturalHeight = video?.videoHeight ?? 0;
        if (naturalWidth > 0 && naturalHeight > 0) {
          const scale = Math.min(frameWidth / naturalWidth, frameHeight / naturalHeight, 1);
          return {
            width: Math.round(clamp(naturalWidth * scale, 160, 1280)),
            height: Math.round(clamp(naturalHeight * scale, 120, 960))
          };
        }
      }

      if (node.data.sourceType === "markdown") {
        const body = nodeElement?.querySelector<HTMLElement>(".markdown-body");
        const preview = nodeElement?.querySelector<HTMLElement>(".markdown-preview");
        if (body && preview) {
          return {
            width: Math.round(clamp(Math.max(body.scrollWidth, preview.clientWidth) + 24, 360, 1280)),
            height: Math.round(clamp(body.scrollHeight + 36, 320, 1200))
          };
        }
      }

      const content = nodeElement?.querySelector<HTMLElement>(".canvas-node");
      if (content) {
        const rect = content.getBoundingClientRect();
        return {
          width: Math.round(clamp(rect.width / zoom, 160, 1280)),
          height: Math.round(clamp(rect.height / zoom, 120, 1200))
        };
      }

      const defaultSize = defaultNodeSizes[node.data.sourceType];
      return { width: defaultSize.width, height: defaultSize.height };
    },
    [getZoom]
  );

  const fitSelectedToContent = useCallback(() => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);

    setNodes((items) => {
      pushHistory(items);
      const sized = items.map((node) => (selected.has(node.id) ? sizeNode(node, measureNodeContent(node)) : node));
      const selectedNodes = sized.filter((node) => selected.has(node.id));
      const positions = selectedNodes.length > 1 ? computeSmartLayout(selectedNodes) : new Map<string, { x: number; y: number }>();
      const next = sized.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      });
      void persistCanvas(next);
      return next;
    });
    notify("Fit to content");
  }, [measureNodeContent, notify, persistCanvas, pushHistory, selectedIds, setNodes]);

  const applyViewportPreset = useCallback(
    (preset: ViewportPreset) => {
      if (!selectedIds.length) return;
      const selected = new Set(selectedIds);
      const size = viewportPresets[preset];
      setNodes((items) => {
        pushHistory(items);
        const sized = items.map((node) => (selected.has(node.id) ? sizeNode(node, size) : node));
        const selectedNodes = sized.filter((node) => selected.has(node.id));
        const positions = selectedNodes.length > 1 ? computeSmartLayout(selectedNodes) : new Map<string, { x: number; y: number }>();
        const next = sized.map((node) => {
          const position = positions.get(node.id);
          return position ? { ...node, position } : node;
        });
        void persistCanvas(next);
        return next;
      });
      notify(`Set ${size.label} size`);
    },
    [notify, persistCanvas, pushHistory, selectedIds, setNodes]
  );

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    setNodes((items) => {
      pushHistory(items);
      const next = items.filter((node) => !selected.has(node.id));
      void persistCanvas(next);
      return next;
    });
    setSelectedIds([]);
    notify("Selection deleted");
  }, [notify, persistCanvas, pushHistory, selectedIds, setNodes]);

  const clearSelection = useCallback(() => {
    if (!selectedIds.length) return;
    setNodes((items) => items.map((node) => (node.selected ? { ...node, selected: false } : node)));
    setSelectedIds([]);
  }, [selectedIds.length, setNodes]);

  const selectAllNodes = useCallback(() => {
    const allIds = nodesRef.current.map((node) => node.id);
    if (!allIds.length) return;
    setNodes((items) => items.map((node) => (node.selected ? node : { ...node, selected: true })));
    setSelectedIds(allIds);
    setStatus("All nodes selected");
  }, [setNodes]);

  const duplicateSelected = useCallback(() => {
    const targets = getSelectedNodes();
    if (!targets.length) return;
    const selected = new Set(targets.map((node) => node.id));
    const timestamp = Date.now();
    const duplicates: CanvasNode[] = targets.map((source, index) => ({
      ...source,
      id: `${source.id}-${timestamp}-${index}`,
      selected: true,
      position: {
        x: source.position.x + 48,
        y: source.position.y + 48
      },
      data: { ...source.data }
    }));

    setNodes((items) => {
      pushHistory(items);
      const next = items.map((node) => (selected.has(node.id) ? { ...node, selected: false } : node)).concat(duplicates);
      void persistCanvas(next);
      return next;
    });
    setSelectedIds(duplicates.map((node) => node.id));
    setStatus(`Duplicated ${duplicates.length} node${duplicates.length === 1 ? "" : "s"}`);
  }, [getSelectedNodes, persistCanvas, pushHistory, setNodes]);

  const copySelectedContext = useCallback(async () => {
    const selectedNodes = getSelectedNodes();
    if (!selectedNodes.length) return;
    const chunks = await Promise.all(
      selectedNodes.map(async (node) => {
        let content = node.data.content ?? "";
        if (!content && node.data.path && ["markdown", "html", "file"].includes(node.data.sourceType)) {
          content = await readText(node.data.path).catch(() => "");
        }
        return [
          `## ${node.data.title}`,
          `node_id: ${node.id}`,
          `type: ${node.data.sourceType}`,
          node.data.path ? `path: ${node.data.path}` : "",
          node.data.summary ? `summary: ${node.data.summary}` : "",
          node.data.asset ? `asset: ${JSON.stringify(node.data.asset)}` : "",
          "",
          content || "(Media node or canvas metadata.)"
        ]
          .filter(Boolean)
          .join("\n");
      })
    );
    await navigator.clipboard.writeText(["# Canvas Selection Context", "", ...chunks].join("\n\n"));
    notify("Selection context copied");
  }, [getSelectedNodes, notify]);

  const copySelectedContent = useCallback(async () => {
    const targets = getSelectedNodes();
    if (!targets.length) return;
    const payloads = await Promise.all(targets.map((node) => getNodeClipboardPayload(node)));
    await writeClipboardPayload({
      plain: payloads.map((payload) => payload.plain).join("\n\n"),
      html: payloads.map((payload) => payload.html ?? `<pre>${escapeHtmlText(payload.plain)}</pre>`).join("")
    });
    notify("Content copied");
  }, [getNodeClipboardPayload, getSelectedNodes, notify]);

  const copySelectedPath = useCallback(async () => {
    const targets = getSelectedNodes();
    if (!targets.length) return;
    await navigator.clipboard.writeText(targets.map((node) => node.data.path).filter(Boolean).join("\n"));
    notify("Path copied");
  }, [getSelectedNodes, notify]);

  const copyBottomPath = useCallback(async () => {
    await navigator.clipboard.writeText(canvasFolderPath);
    setStatus("Path copied");
  }, []);

  const focusNode = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((item) => item.id === id);
      if (!node) return;
      setNodes((items) =>
        items.map((item) => {
          const selected = item.id === id;
          return item.selected === selected ? item : { ...item, selected };
        })
      );
      setSelectedIds([id]);
      setCenter(node.position.x + 220, node.position.y + 170, { zoom: 1, duration: 420 });
    },
    [setCenter, setNodes]
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".tiptap-body, textarea, input, [contenteditable='true'], .source-editor, .prompt-editor")) return;

      const key = event.key.toLowerCase();
      const usesCommand = event.metaKey || event.ctrlKey;

      if (usesCommand && key === "z") {
        event.preventDefault();
        restoreHistory(event.shiftKey ? "redo" : "undo");
        return;
      }

      if (event.ctrlKey && key === "y") {
        event.preventDefault();
        restoreHistory("redo");
        return;
      }

      if (key === "escape") {
        event.preventDefault();
        if (inspectorNodeId) {
          setInspectorNodeId(null);
        } else {
          clearSelection();
        }
        return;
      }

      if (usesCommand && key === "c") {
        event.preventDefault();
        const now = performance.now();
        if (now - lastCopyShortcutRef.current < 650) {
          lastCopyShortcutRef.current = 0;
          void copySelectedPath();
        } else {
          lastCopyShortcutRef.current = now;
          void copySelectedContent();
        }
        return;
      }

      if (usesCommand && key === "a") {
        event.preventDefault();
        selectAllNodes();
        return;
      }

      if (usesCommand && key === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }

      if (usesCommand && key === "g") {
        event.preventDefault();
        arrangeSelected();
        return;
      }

      if (!usesCommand && (key === "backspace" || key === "delete")) {
        event.preventDefault();
        deleteSelected();
        return;
      }

      if (!usesCommand && key === "0") {
        event.preventDefault();
        void fitView({ padding: 0.18, duration: 360, maxZoom: 1 });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [arrangeSelected, clearSelection, copySelectedContent, copySelectedPath, deleteSelected, duplicateSelected, fitView, inspectorNodeId, restoreHistory, selectAllNodes]);

  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: CanvasNode[] }) => {
    const nextIds = selected.map((node) => node.id);
    setSelectedIds((current) => {
      if (current.length === nextIds.length && current.every((id, index) => id === nextIds[index])) {
        return current;
      }
      return nextIds;
    });
  }, []);

  const onCanvasDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }, []);

  const onCanvasDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragActive(false);
  }, []);

  const onCanvasDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      setDragActive(false);
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      void uploadDroppedFiles(event.dataTransfer.files, position).catch((error) => setStatus(error.message));
    },
    [screenToFlowPosition, uploadDroppedFiles]
  );

  const onCanvasWheelCapture = useCallback((event: React.WheelEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const startsInContent = Boolean(
      target?.closest(
        ".content-inspector, .canvas-toolbar, .path-bar, .react-flow__controls, .markdown-preview, .markdown-body, .tiptap-body, textarea, input, .source-editor, .prompt-editor"
      )
        || target?.closest(".top-strip, .board-menu")
    );
    const owner = wheelOwnerRef.current ?? (startsInContent ? "content" : "canvas");
    wheelOwnerRef.current = owner;
    setWheelOwner((current) => (current === owner ? current : owner));

    if (wheelResetRef.current) clearTimeout(wheelResetRef.current);
    wheelResetRef.current = setTimeout(() => {
      wheelOwnerRef.current = null;
      setWheelOwner(null);
    }, 180);
  }, []);

  useEffect(() => {
    return () => {
      if (wheelResetRef.current) clearTimeout(wheelResetRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const selectionActions = useMemo<SelectionActions>(
    () => ({
      selectedCount: selectedIds.length,
      copySelectedContent: () => void copySelectedContent(),
      copySelectedPath: () => void copySelectedPath(),
      copySelectedContext: () => void copySelectedContext(),
      arrangeSelected,
      deleteSelected
    }),
    [arrangeSelected, copySelectedContent, copySelectedContext, copySelectedPath, deleteSelected, selectedIds.length]
  );

  return (
    <main className="app-shell">
      <section
        ref={canvasAreaRef}
        style={canvasAreaStyle}
        className={`canvas-area ${dragActive ? "is-dragging-file" : ""} ${nodeDragging ? "is-node-dragging" : ""} ${wheelOwner === "canvas" ? "is-canvas-gesture" : ""}`}
        onDragOver={onCanvasDragOver}
        onDragLeave={onCanvasDragLeave}
        onDrop={onCanvasDrop}
        onWheelCapture={onCanvasWheelCapture}
      >
        <div className="top-strip">
          <section className="board-switcher" ref={boardSwitcherRef}>
            <button type="button" className="board-trigger" title="Switch board" onClick={() => setBoardMenuOpen((value) => !value)} aria-expanded={boardMenuOpen}>
              <Layers3 size={16} />
              <span>{currentBoard?.title ?? "Main"}</span>
              <ChevronDown size={14} />
            </button>
            {boardMenuOpen ? (
              <div className="board-menu" role="menu" aria-label="Boards">
                <div className="board-list">
                  {boards.map((board) => {
                    const isConfirming = confirmingBoardId === board.id;
                    const canDelete = boards.length > 1;
                    return (
                      <div key={board.id} className={`board-menu-row ${board.id === currentBoardId ? "active" : ""}`}>
                        <button
                          type="button"
                          role="menuitem"
                          className="board-menu-select"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void switchBoard(board.id);
                          }}
                        >
                          <span>{board.title}</span>
                        </button>
                        {isConfirming ? (
                          <span className="board-delete-confirm">
                            <span
                              role="button"
                              tabIndex={0}
                              onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void deleteBoard(board.id);
                              }}
                            >
                              Delete
                            </span>
                            <span
                              role="button"
                              tabIndex={0}
                              onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setConfirmingBoardId(null);
                              }}
                            >
                              Cancel
                            </span>
                          </span>
                        ) : (
                          <span
                            role="button"
                            tabIndex={canDelete ? 0 : -1}
                            className={`board-delete-control ${canDelete ? "" : "disabled"}`}
                            title={canDelete ? `Delete ${board.title}` : "Keep at least one board"}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (canDelete) setConfirmingBoardId(board.id);
                            }}
                          >
                            <Trash2 size={13} />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
          <CanvasToolbar onAddFiles={addFilesFromToolbar} onAddMarkdown={addMarkdownFromToolbar} />
        </div>
        <button className="path-bar" title="Click to copy canvas folder path" onClick={copyBottomPath}>
          <span>{canvasFolderPath}</span>
        </button>
        <InspectorHost node={inspectorNode} boardId={currentBoardId} onClose={() => setInspectorNodeId(null)} />
        <div className="drop-hint">Drop files to add them to the canvas</div>
        {toast ? <div className="toast-message" role="status">{toast}</div> : null}
        {selectedIds.length ? (
          <div className="selection-toolbar" style={selectionToolbarStyle}>
            <button title="Fit to Content" onClick={fitSelectedToContent}>
              <Scan size={16} />
            </button>
            <span className="selection-divider" />
            <button title="Phone Size" onClick={() => applyViewportPreset("phone")}>
              <Smartphone size={16} />
            </button>
            <button title="Tablet Size" onClick={() => applyViewportPreset("tablet")}>
              <Tablet size={16} />
            </button>
            <button title="Desktop Size" onClick={() => applyViewportPreset("desktop")}>
              <Monitor size={16} />
            </button>
            {selectedIds.length > 1 ? <span className="selection-divider" /> : null}
            {selectedIds.length > 1 ? (
              <>
            <button title="Copy Selection Context" onClick={copySelectedContext}>
              <Clipboard size={16} />
            </button>
            <button title="Smart Arrange" onClick={arrangeSelected}>
              <LayoutGrid size={16} />
            </button>
            <button title="Align Horizontally" onClick={() => alignSelected("y")}>
              <AlignHorizontalJustifyCenter size={16} />
            </button>
            <button title="Align Vertically" onClick={() => alignSelected("x")}>
              <AlignVerticalJustifyCenter size={16} />
            </button>
            <button title="Delete Selection" onClick={deleteSelected}>
              <Trash2 size={16} />
            </button>
              </>
            ) : null}
          </div>
        ) : null}

        <SelectionActionsContext.Provider value={selectionActions}>
          <ReactFlow
            nodes={nodes}
            edges={emptyEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStart={() => {
              pushHistory();
              setNodeDragging(true);
            }}
            onNodeDragStop={() => {
              setNodeDragging(false);
              void persistCanvas(nodesRef.current);
            }}
            onNodeDrag={() => {
              if (!nodeDragging) setNodeDragging(true);
            }}
            onNodeDoubleClick={(_, node) => setInspectorNodeId(node.id)}
            onSelectionChange={onSelectionChange}
            panOnScroll
            panOnScrollSpeed={1.35}
            panOnScrollMode={PanOnScrollMode.Free}
            panOnDrag={[2]}
            selectionOnDrag
            selectionKeyCode={null}
            multiSelectionKeyCode={["Shift", "Meta", "Control"]}
            selectionMode={SelectionMode.Partial}
            snapToGrid
            snapGrid={snapGrid}
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            onlyRenderVisibleElements
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
            defaultViewport={{ x: 96, y: 72, zoom: 0.46 }}
            minZoom={0.08}
            maxZoom={2.2}
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} color="#d7cbb7" gap={24} size={1.4} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </SelectionActionsContext.Provider>
      </section>
    </main>
  );
}

export default function Page() {
  return (
    <ReactFlowProvider>
      <CanvasApp />
    </ReactFlowProvider>
  );
}

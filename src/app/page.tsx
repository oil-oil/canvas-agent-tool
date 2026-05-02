"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  NodeProps,
  NodeResizer,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useNodesState,
  type Edge,
  type Node as FlowNode,
  type NodeChange
} from "@xyflow/react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";
import TurndownService from "turndown";
import { AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, Clipboard, Copy, FilePlus2, LayoutGrid, Plus, Save, Trash2, X } from "lucide-react";
import { FileHtml, FileMd, FileText, ImageSquare, Path, Sparkle, VideoCamera } from "@phosphor-icons/react";
import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type SourceType = "markdown" | "html" | "image" | "video" | "prompt" | "file";

type MenuItem = {
  label: string;
  icon?: React.ReactNode;
  action: () => void | Promise<void>;
  danger?: boolean;
};

type CanvasNodeData = {
  title: string;
  path?: string;
  content?: string;
  sourceType: SourceType;
  summary?: string;
  preview?: boolean;
  width?: number;
  height?: number;
  onUpdate?: (id: string, patch: Partial<CanvasNodeData>) => void;
  onResize?: (id: string, size: { width: number; height: number }, options?: { persist?: boolean }) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onCopyContext?: (id: string) => void;
  onCopyContent?: (id: string) => void;
  onCopyPath?: (id: string) => void;
};

type UploadedFile = {
  title: string;
  path: string;
  sourceType: SourceType;
};

type CanvasNode = FlowNode<CanvasNodeData>;

type CanvasDocument = {
  nodes: CanvasNode[];
  edges?: Edge[];
};

type SelectionActions = {
  selectedCount: number;
  copySelectedContent: () => void;
  copySelectedPath: () => void;
  copySelectedContext: () => void;
  arrangeSelected: () => void;
  deleteSelected: () => void;
};

const emptyEdges: Edge[] = [];
const snapGrid: [number, number] = [24, 24];
const SelectionActionsContext = React.createContext<SelectionActions | null>(null);
const supportedFileAccept = [
  ".md",
  ".mdx",
  ".markdown",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  "image/*",
  "video/*",
  "text/html",
  "text/markdown"
].join(",");
const supportedDropExtensions = new Set([
  ".md",
  ".mdx",
  ".markdown",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".mp4",
  ".webm",
  ".mov",
  ".m4v"
]);

const sourceIcons: Record<SourceType, React.ReactNode> = {
  markdown: <FileMd size={19} weight="duotone" />,
  html: <FileHtml size={19} weight="duotone" />,
  image: <ImageSquare size={19} weight="duotone" />,
  video: <VideoCamera size={19} weight="duotone" />,
  prompt: <Sparkle size={19} weight="duotone" />,
  file: <FileText size={19} weight="duotone" />
};

function rawUrl(path?: string) {
  return path ? `/api/files/raw?path=${encodeURIComponent(path)}` : "";
}

function fileExtension(name: string) {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
}

function isSupportedFile(file: File) {
  return supportedDropExtensions.has(fileExtension(file.name));
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markdownToHtml(markdown: string) {
  return marked.parse(markdown, { async: false }) as string;
}

const TiptapVideo = TiptapNode.create({
  name: "mediaVideo",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      title: { default: null }
    };
  },
  parseHTML() {
    return [{ tag: "video[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["video", mergeAttributes(HTMLAttributes, { controls: "true" })];
  }
});

const TiptapIframe = TiptapNode.create({
  name: "htmlEmbed",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      title: { default: null }
    };
  },
  parseHTML() {
    return [{ tag: "iframe[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["iframe", mergeAttributes(HTMLAttributes, { loading: "lazy" })];
  }
});

function htmlForMarkdownDrop(file: UploadedFile) {
  const src = rawUrl(file.path);
  const title = escapeHtmlAttribute(file.title);
  if (file.sourceType === "image") {
    return `<p><img src="${src}" alt="${title}"></p>`;
  }
  if (file.sourceType === "video") {
    return `<video src="${src}" title="${title}" controls></video>`;
  }
  if (file.sourceType === "html") {
    return `<iframe src="${src}" title="${title}"></iframe>`;
  }
  return `<p>${title}</p>`;
}

async function uploadCanvasFiles(input: FileList | File[]) {
  const files = Array.from(input).filter(isSupportedFile);
  if (!files.length) {
    throw new Error("Choose image, video, HTML, or Markdown files.");
  }
  return Promise.all(
    files.map(async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Import failed");
      return payload as UploadedFile;
    })
  );
}

async function createMarkdownFile() {
  const response = await fetch("/api/files/create", { method: "POST" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Create failed");
  return payload as UploadedFile;
}

function stripRuntimeData(nodes: CanvasNode[]) {
  return nodes.map((node) => ({
    ...node,
    data: {
      title: node.data.title,
      path: node.data.path,
      content: node.data.content,
      sourceType: node.data.sourceType,
      summary: node.data.summary,
      preview: node.data.preview,
      width: node.data.width,
      height: node.data.height
    }
  }));
}

async function readText(path?: string) {
  if (!path) return "";
  const response = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Read failed");
  return payload.content as string;
}

async function writeText(path: string | undefined, content: string) {
  if (!path) return;
  const response = await fetch("/api/files/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, content })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Save failed");
}

async function writeClipboardPayload(payload: { plain: string; html?: string }) {
  if (payload.html && "ClipboardItem" in window && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([payload.plain], { type: "text/plain" }),
        "text/html": new Blob([payload.html], { type: "text/html" })
      })
    ]);
    return;
  }
  await navigator.clipboard.writeText(payload.plain);
}

function NodeContextMenu({
  children,
  items
}: {
  children: React.ReactNode;
  items: MenuItem[];
}) {
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu">
          {items.map((item, index) => (
            <ContextMenu.Item
              key={`${item.label}-${index}`}
              className={item.danger ? "context-menu-item danger" : "context-menu-item"}
              onSelect={item.action}
            >
              {item.icon}
              <span>{item.label}</span>
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function defaultMenuItems(id: string, data: CanvasNodeData, extra: MenuItem[] = []) {
  return [
    ...extra,
    {
      label: "Copy Content Ctrl+C",
      icon: <Clipboard size={15} />,
      action: () => data.onCopyContent?.(id)
    },
    {
      label: "Copy Path Option+Command+C / Ctrl+Alt+C",
      icon: <Path size={15} weight="duotone" />,
      action: () => data.onCopyPath?.(id)
    },
    {
      label: "Copy Context",
      icon: <Copy size={15} />,
      action: () => data.onCopyContext?.(id)
    },
    {
      label: "Duplicate Node",
      icon: <Copy size={15} />,
      action: () => data.onDuplicate?.(id)
    },
    {
      label: "Delete",
      icon: <Trash2 size={15} />,
      action: () => data.onDelete?.(id),
      danger: true
    }
  ];
}

function NodeShell({
  id,
  data,
  children,
  className = "",
  menuItems = [],
  selected = false
}: {
  id: string;
  data: CanvasNodeData;
  children: React.ReactNode;
  className?: string;
  menuItems?: MenuItem[];
  selected?: boolean;
}) {
  const selectionActions = useContext(SelectionActionsContext);
  const minSize = useMemo(() => {
    if (data.sourceType === "image" || data.sourceType === "video") {
      return { width: 120, height: 92 };
    }
    if (data.sourceType === "file") {
      return { width: 170, height: 118 };
    }
    return { width: 220, height: 160 };
  }, [data.sourceType]);
  const nodeStyle = useMemo(
    () => ({
      width: data.width ? `${data.width}px` : undefined,
      height: data.height ? `${data.height}px` : undefined
    }),
    [data.height, data.width]
  );
  const resize = useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      data.onResize?.(id, { width: Math.round(params.width), height: Math.round(params.height) });
    },
    [data, id]
  );
  const finishResize = useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      data.onResize?.(id, { width: Math.round(params.width), height: Math.round(params.height) }, { persist: true });
    },
    [data, id]
  );
  const items = useMemo(() => {
    const batchItems: MenuItem[] =
      selected && selectionActions && selectionActions.selectedCount > 1
        ? [
            {
              label: "Copy Selection Content",
              icon: <Clipboard size={15} />,
              action: selectionActions.copySelectedContent
            },
            {
              label: "Copy Selection Paths",
              icon: <Path size={15} weight="duotone" />,
              action: selectionActions.copySelectedPath
            },
            {
              label: "Copy Selection Context",
              icon: <Copy size={15} />,
              action: selectionActions.copySelectedContext
            },
            {
              label: "Arrange Selection",
              icon: <LayoutGrid size={15} />,
              action: selectionActions.arrangeSelected
            },
            {
              label: "Delete Selection",
              icon: <Trash2 size={15} />,
              action: selectionActions.deleteSelected,
              danger: true
            }
          ]
        : [];
    return defaultMenuItems(id, data, [...batchItems, ...menuItems]);
  }, [data, id, menuItems, selected, selectionActions]);

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={minSize.width}
        minHeight={minSize.height}
        keepAspectRatio={data.sourceType === "image" || data.sourceType === "video"}
        autoScale
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
        onResize={resize}
        onResizeEnd={finishResize}
      />
      <NodeContextMenu items={items}>
        <div className="node-frame">
          <div className="node-caption">
            <span>{sourceIcons[data.sourceType]}</span>
            <strong>{data.title}</strong>
          </div>
          <section className={`canvas-node ${data.sourceType} ${className} ${data.width || data.height ? "is-sized" : ""}`} style={nodeStyle}>
            {children}
          </section>
        </div>
      </NodeContextMenu>
    </>
  );
}

function MarkdownEditor({
  id,
  data,
  onBindSave
}: {
  id: string;
  data: CanvasNodeData;
  onBindSave: (save?: () => Promise<void>) => void;
}) {
  const [status, setStatus] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turndown = useMemo(
    () => {
      const service = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced"
      });
      service.addRule("video", {
        filter: "video",
        replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`
      });
      service.addRule("iframe", {
        filter: "iframe",
        replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`
      });
      return service;
    },
    []
  );
  const editor = useEditor({
    extensions: [StarterKit, Image, TiptapVideo, TiptapIframe],
    content: "",
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setStatus("Unsaved changes");
      saveTimerRef.current = setTimeout(async () => {
        const markdown = turndown.turndown(editor.getHTML());
        setStatus("Saving");
        await writeText(data.path, markdown);
        data.onUpdate?.(id, { content: markdown });
        setStatus("Saved");
      }, 900);
    },
    editorProps: {
      attributes: {
        class: "tiptap-body nowheel nodrag nopan"
      }
    }
  });

  useEffect(() => {
    let cancelled = false;
    setStatus("");
    readText(data.path)
      .then((markdown) => {
        if (cancelled) return;
        editor?.commands.setContent(markdownToHtml(markdown), { emitUpdate: false });
        data.onUpdate?.(id, { content: markdown });
      })
      .catch((error) => setStatus(error.message));
    return () => {
      cancelled = true;
    };
  }, [data.path, editor, id]);

  const saveSource = useCallback(async () => {
    if (!editor) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const markdown = turndown.turndown(editor.getHTML());
    setStatus("Saving");
    await writeText(data.path, markdown);
    data.onUpdate?.(id, { content: markdown });
    setStatus("Saved");
  }, [data, editor, id, turndown]);

  useEffect(() => {
    onBindSave(saveSource);
    return () => onBindSave(undefined);
  }, [onBindSave, saveSource]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleAssetDragOver = useCallback((event: React.DragEvent) => {
    const files = Array.from(event.dataTransfer.files).filter((file) => ["image", "video", "text/html", "text/markdown"].some((type) => file.type.startsWith(type)) || isSupportedFile(file));
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleAssetDrop = useCallback(
    async (event: React.DragEvent) => {
      const files = Array.from(event.dataTransfer.files).filter(isSupportedFile);
      if (!editor || !files.length) return;
      event.preventDefault();
      event.stopPropagation();
      setStatus("Inserting files");
      try {
        const uploaded = await uploadCanvasFiles(files);
        const embeddable = uploaded.filter((file) => file.sourceType === "image" || file.sourceType === "video" || file.sourceType === "html");
        if (!embeddable.length) {
          setStatus("This file can be added to the canvas, but not embedded in the editor yet.");
          return;
        }
        editor.chain().focus().insertContent(embeddable.map(htmlForMarkdownDrop).join("")).run();
        setStatus("Inserted");
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [editor]
  );

  return (
    <>
      <EditorContent editor={editor} className="markdown-editor" onDragOver={handleAssetDragOver} onDrop={handleAssetDrop} />
      {status ? <span className="node-status">{status}</span> : null}
    </>
  );
}

function MarkdownPreview({ id, data }: { id: string; data: CanvasNodeData }) {
  const [markdown, setMarkdown] = useState(data.content ?? "");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (data.content) {
      setMarkdown(data.content);
      return () => {
        cancelled = true;
      };
    }
    readText(data.path)
      .then((content) => {
        if (cancelled) return;
        setMarkdown(content);
        data.onUpdate?.(id, { content });
      })
      .catch((error) => setStatus(error.message));
    return () => {
      cancelled = true;
    };
  }, [data.content, data.onUpdate, data.path, id]);

  return (
    <div className="markdown-preview nowheel">
      {markdown ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown) }} /> : <span>{status || "Reading"}</span>}
    </div>
  );
}

const MarkdownNode = memo(function MarkdownNode({ id, data, selected }: NodeProps<CanvasNode>) {
  return (
    <NodeShell id={id} data={data} className="paper-node" selected={selected}>
      <MarkdownPreview id={id} data={data} />
    </NodeShell>
  );
});

const HtmlNode = memo(function HtmlNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const [content, setContent] = useState("");
  const [sourceMode, setSourceMode] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!sourceMode) return;
    readText(data.path).then(setContent).catch((error) => setStatus(error.message));
  }, [data.path, sourceMode]);

  async function saveSource() {
    setStatus("Saving");
    await writeText(data.path, content);
    data.onUpdate?.(id, { content });
    setStatus("Saved");
  }

  return (
    <NodeShell
      id={id}
      data={data}
      className="paper-node html-node"
      selected={selected}
      menuItems={[
        {
          label: sourceMode ? "Preview HTML" : "Edit Source",
          icon: <FileHtml size={15} weight="duotone" />,
          action: () => setSourceMode((value) => !value)
        },
        {
          label: "Save Source File",
          icon: <Save size={15} />,
          action: saveSource
        }
      ]}
    >
      {sourceMode ? (
        <textarea className="source-editor code nowheel nodrag nopan" value={content} onChange={(event) => setContent(event.target.value)} />
      ) : (
        <iframe className="html-frame nowheel nodrag nopan" src={rawUrl(data.path)} sandbox="allow-same-origin" title={data.title} loading="lazy" />
      )}
      {status ? <span className="node-status">{status}</span> : null}
    </NodeShell>
  );
});

const ImageNode = memo(function ImageNode({ id, data, selected }: NodeProps<CanvasNode>) {
  return (
    <NodeShell id={id} data={data} className="media-node image-node" selected={selected}>
      <img className="media-image" src={rawUrl(data.path)} alt={data.title} loading="eager" decoding="async" fetchPriority="low" />
    </NodeShell>
  );
});

const VideoNode = memo(function VideoNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const [armed, setArmed] = useState(false);
  const active = selected || armed || data.preview;

  return (
    <NodeShell id={id} data={data} className="media-node video-node" selected={selected}>
      {active && data.path ? (
        <video className="media-video nowheel nodrag nopan" src={rawUrl(data.path)} controls preload="none" />
      ) : (
        <button className="media-placeholder video-placeholder" onMouseEnter={() => setArmed(true)} onFocus={() => setArmed(true)}>
          <VideoCamera size={34} weight="duotone" />
          <span>{data.title}</span>
        </button>
      )}
    </NodeShell>
  );
});

const PromptNode = memo(function PromptNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const [content, setContent] = useState(data.content ?? "");

  useEffect(() => {
    setContent(data.content ?? "");
  }, [data.content]);

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextContent = event.target.value;
    setContent(nextContent);
    data.onUpdate?.(id, { content: nextContent });
  }

  return (
    <NodeShell id={id} data={data} className="paper-node prompt-node" selected={selected}>
      <textarea className="prompt-editor nowheel nodrag nopan" value={content} onChange={handleChange} />
    </NodeShell>
  );
});

const FileNode = memo(function FileNode({ id, data, selected }: NodeProps<CanvasNode>) {
  return (
    <NodeShell id={id} data={data} className="paper-node file-node" selected={selected}>
      <div className="file-card">{data.path}</div>
    </NodeShell>
  );
});

function ImagePreviewInspector({ node }: { node: CanvasNode }) {
  return (
    <div className="image-preview-pane">
      <img className="inspector-image" src={rawUrl(node.data.path)} alt={node.data.title} draggable={false} />
    </div>
  );
}

function InspectorContent({ node }: { node: CanvasNode }) {
  const [content, setContent] = useState(node.data.content ?? "");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    setContent(node.data.content ?? "");
    setStatus("");
    if (node.data.path && ["markdown", "file"].includes(node.data.sourceType)) {
      readText(node.data.path)
        .then((text) => {
          if (!cancelled) setContent(text);
        })
        .catch((error) => {
          if (!cancelled) setStatus(error.message);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [node.data.content, node.data.path, node.data.sourceType]);

  if (node.data.sourceType === "html") {
    return <iframe className="inspector-frame" src={rawUrl(node.data.path)} sandbox="allow-same-origin" title={node.data.title} />;
  }

  if (node.data.sourceType === "markdown") {
    return (
      <div className="inspector-editor">
        <MarkdownEditor id={node.id} data={{ ...node.data, content }} onBindSave={() => undefined} />
      </div>
    );
  }

  if (node.data.sourceType === "image") {
    return <ImagePreviewInspector node={node} />;
  }

  if (node.data.sourceType === "video") {
    return <video className="inspector-media" src={rawUrl(node.data.path)} controls preload="metadata" />;
  }

  if (node.data.sourceType === "prompt") {
    return <pre className="inspector-text">{node.data.content ?? ""}</pre>;
  }

  return <pre className="inspector-text">{content || status || node.data.path}</pre>;
}

const InspectorDrawer = memo(function InspectorDrawer({
  node,
  closing,
  onClose,
  onExitComplete
}: {
  node: CanvasNode;
  closing?: boolean;
  onClose: () => void;
  onExitComplete?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const pathText = node.data.path ?? node.id;

  const copyPath = useCallback(async () => {
    await navigator.clipboard.writeText(pathText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1100);
  }, [pathText]);

  return (
    <aside className={`content-inspector${closing ? " is-closing" : ""}`} onAnimationEnd={() => closing && onExitComplete?.()}>
      <header className="inspector-header">
        <span className="inspector-icon">{sourceIcons[node.data.sourceType]}</span>
        <button className="inspector-title-button" onClick={copyPath} title={`${copied ? "Copied" : "Click to copy path"}\n${pathText}`}>
          <strong>{node.data.title}</strong>
        </button>
        <button className="inspector-close" onClick={onClose} title="Close Preview" aria-label="Close Preview">
          <X size={16} />
        </button>
      </header>
      <section className="inspector-body">
        <InspectorContent node={node} />
      </section>
    </aside>
  );
});

const InspectorHost = memo(function InspectorHost({ node, onClose }: { node: CanvasNode | null; onClose: () => void }) {
  const [renderedNode, setRenderedNode] = useState<CanvasNode | null>(node);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (node) {
      setRenderedNode(node);
      setClosing(false);
      return;
    }
    if (renderedNode) {
      setClosing(true);
    }
  }, [node, renderedNode]);

  const completeExit = useCallback(() => {
    if (!closing) return;
    setRenderedNode(null);
    setClosing(false);
  }, [closing]);

  if (!renderedNode) return null;

  return <InspectorDrawer node={renderedNode} closing={closing} onClose={onClose} onExitComplete={completeExit} />;
});

const nodeTypes = {
  markdown: MarkdownNode,
  html: HtmlNode,
  image: ImageNode,
  video: VideoNode,
  prompt: PromptNode,
  file: FileNode
};

const CanvasToolbar = memo(function CanvasToolbar({
  onAddFiles,
  onAddMarkdown
}: {
  onAddFiles: (files: FileList) => void;
  onAddMarkdown: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => window.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  const chooseFiles = useCallback(() => {
    setOpen(false);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.currentTarget.files?.length) {
        onAddFiles(event.currentTarget.files);
      }
      event.currentTarget.value = "";
    },
    [onAddFiles]
  );

  const addMarkdown = useCallback(() => {
    setOpen(false);
    onAddMarkdown();
  }, [onAddMarkdown]);

  return (
    <section className="canvas-toolbar" ref={toolbarRef}>
      <button className="toolbar-trigger" title="Add Content" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <Plus size={17} />
        <span>Add Content</span>
      </button>
      {open ? (
        <div className="toolbar-menu">
          <button onClick={chooseFiles}>
            <FilePlus2 size={15} />
            <span>Add Files</span>
          </button>
          <button onClick={addMarkdown}>
            <FileMd size={16} weight="duotone" />
            <span>New Markdown</span>
          </button>
        </div>
      ) : null}
      <input ref={fileInputRef} className="hidden-file-input" type="file" multiple accept={supportedFileAccept} onChange={handleFileChange} />
    </section>
  );
});

function CanvasApp() {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<CanvasNode>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading canvas");
  const [canvasFolderPath, setCanvasFolderPath] = useState(".canvas");
  const [dragActive, setDragActive] = useState(false);
  const [nodeDragging, setNodeDragging] = useState(false);
  const [wheelOwner, setWheelOwner] = useState<"canvas" | "content" | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const wheelOwnerRef = useRef<"canvas" | "content" | null>(null);
  const wheelResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { screenToFlowPosition, setCenter, fitView } = useReactFlow<CanvasNode, Edge>();

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const getSelectedNodes = useCallback(() => {
    const selected = new Set(selectedIds);
    return nodesRef.current.filter((node) => selected.has(node.id));
  }, [selectedIds]);

  const inspectorNode = useMemo(() => nodes.find((node) => node.id === inspectorNodeId) ?? null, [inspectorNodeId, nodes]);

  useEffect(() => {
    if (inspectorNodeId && !inspectorNode) {
      setInspectorNodeId(null);
    }
  }, [inspectorNode, inspectorNodeId]);

  const persistCanvas = useCallback(
    async (nextNodes = nodesRef.current) => {
      await fetch("/api/canvas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodes: stripRuntimeData(nextNodes), edges: [] })
      });
      setStatus("Canvas saved");
    },
    []
  );

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
          if (node.data.width === size.width && node.data.height === size.height) return node;
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              width: size.width,
              height: size.height
            }
          };
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
        const next = items.filter((node) => node.id !== id);
        void persistCanvas(next);
        return next;
      });
    },
    [persistCanvas, setNodes]
  );

  const duplicateNode = useCallback(
    (id: string) => {
      setNodes((items) => {
        const source = items.find((node) => node.id === id);
        if (!source) return items;
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
    [persistCanvas, setNodes]
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
      items.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onUpdate: updateNode,
          onResize: resizeNode,
          onDelete: deleteNode,
          onDuplicate: duplicateNode,
          onCopyContext: copyNodeContext,
          onCopyContent: copyNodeContent,
          onCopyPath: copyNodePath
        }
      })),
    [copyNodeContent, copyNodeContext, copyNodePath, deleteNode, duplicateNode, resizeNode, updateNode]
  );

  useEffect(() => {
    fetch("/api/status")
      .then((response) => response.json())
      .then((payload: { canvasRoot?: string }) => setCanvasFolderPath(payload.canvasRoot ?? ".canvas"))
      .catch(() => setCanvasFolderPath(".canvas"));

    fetch("/api/canvas")
      .then((response) => response.json())
      .then((document: CanvasDocument) => {
        const nextNodes = document.nodes ?? [];
        setNodes(attachRuntime(nextNodes));
        setStatus("Canvas ready");
      })
      .catch((error) => setStatus(error.message));
  }, [attachRuntime, setNodes]);

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
          preview: file.sourceType === "image" || file.sourceType === "video",
          onUpdate: updateNode,
          onResize: resizeNode,
          onDelete: deleteNode,
          onDuplicate: duplicateNode,
          onCopyContext: copyNodeContext,
          onCopyContent: copyNodeContent,
          onCopyPath: copyNodePath
        }
      }));
      setNodes((items) => {
        const next = items.concat(importedNodes);
        void persistCanvas(next);
        return next;
      });
      if (options?.openFirst) {
        setInspectorNodeId(importedNodes[0].id);
        setSelectedIds([importedNodes[0].id]);
      }
      setStatus(`Imported ${files.length} file${files.length === 1 ? "" : "s"}`);
    },
    [copyNodeContent, copyNodeContext, copyNodePath, deleteNode, duplicateNode, persistCanvas, resizeNode, setNodes, updateNode]
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
    const left = Math.min(...selectedNodes.map((node) => node.position.x));
    const top = Math.min(...selectedNodes.map((node) => node.position.y));
    const columns = Math.max(2, Math.ceil(Math.sqrt(selectedNodes.length)));
    const selected = new Set(selectedIds);
    const order = new Map(selectedNodes.map((node, index) => [node.id, index]));

    setNodes((items) => {
      const next = items.map((node) => {
        if (!selected.has(node.id)) return node;
        const index = order.get(node.id) ?? 0;
        return {
          ...node,
          position: {
            x: left + (index % columns) * 320,
            y: top + Math.floor(index / columns) * 260
          }
        };
      });
      void persistCanvas(next);
      return next;
    });
  }, [getSelectedNodes, persistCanvas, selectedIds, setNodes]);

  const alignSelected = useCallback(
    (axis: "x" | "y") => {
      const selectedNodes = getSelectedNodes();
      if (selectedNodes.length < 2) return;
      const value = axis === "x" ? selectedNodes[0].position.x : selectedNodes[0].position.y;
      setNodes((items) => {
        const selected = new Set(selectedIds);
        const next = items.map((node) =>
          selected.has(node.id)
            ? {
                ...node,
                position: {
                  x: axis === "x" ? value : node.position.x,
                  y: axis === "y" ? value : node.position.y
                }
              }
            : node
        );
        void persistCanvas(next);
        return next;
      });
    },
    [getSelectedNodes, persistCanvas, selectedIds, setNodes]
  );

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    setNodes((items) => {
      const next = items.filter((node) => !selected.has(node.id));
      void persistCanvas(next);
      return next;
    });
    setSelectedIds([]);
  }, [persistCanvas, selectedIds, setNodes]);

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
      const next = items.map((node) => (selected.has(node.id) ? { ...node, selected: false } : node)).concat(duplicates);
      void persistCanvas(next);
      return next;
    });
    setSelectedIds(duplicates.map((node) => node.id));
    setStatus(`Duplicated ${duplicates.length} node${duplicates.length === 1 ? "" : "s"}`);
  }, [getSelectedNodes, persistCanvas, setNodes]);

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
          "",
          content || "(Media node or canvas metadata.)"
        ]
          .filter(Boolean)
          .join("\n");
      })
    );
    await navigator.clipboard.writeText(["# Canvas Selection Context", "", ...chunks].join("\n\n"));
    setStatus("Selection context copied");
  }, [getSelectedNodes]);

  const copySelectedContent = useCallback(async () => {
    const targets = getSelectedNodes();
    if (!targets.length) return;
    const payloads = await Promise.all(targets.map((node) => getNodeClipboardPayload(node)));
    await writeClipboardPayload({
      plain: payloads.map((payload) => payload.plain).join("\n\n"),
      html: payloads.map((payload) => payload.html ?? `<pre>${escapeHtmlText(payload.plain)}</pre>`).join("")
    });
    setStatus("Content copied");
  }, [getNodeClipboardPayload, getSelectedNodes]);

  const copySelectedPath = useCallback(async () => {
    const targets = getSelectedNodes();
    if (!targets.length) return;
    await navigator.clipboard.writeText(targets.map((node) => node.data.path).filter(Boolean).join("\n"));
    setStatus("Path copied");
  }, [getSelectedNodes]);

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
        if (event.altKey) {
          void copySelectedPath();
        } else {
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

      if (!usesCommand && key === "0") {
        event.preventDefault();
        void fitView({ padding: 0.18, duration: 360, maxZoom: 1 });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [arrangeSelected, clearSelection, copySelectedContent, copySelectedPath, duplicateSelected, fitView, inspectorNodeId, selectAllNodes]);

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
      target?.closest(".content-inspector, .canvas-toolbar, .path-bar, .react-flow__controls, .tiptap-body, textarea, input, .source-editor, .prompt-editor")
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
        className={`canvas-area ${dragActive ? "is-dragging-file" : ""} ${nodeDragging ? "is-node-dragging" : ""} ${wheelOwner === "canvas" ? "is-canvas-gesture" : ""}`}
        onDragOver={onCanvasDragOver}
        onDragLeave={onCanvasDragLeave}
        onDrop={onCanvasDrop}
        onWheelCapture={onCanvasWheelCapture}
      >
        <CanvasToolbar onAddFiles={addFilesFromToolbar} onAddMarkdown={addMarkdownFromToolbar} />
        <button className="path-bar" title="Click to copy canvas folder path" onClick={copyBottomPath}>
          <span>{canvasFolderPath}</span>
        </button>
        <InspectorHost node={inspectorNode} onClose={() => setInspectorNodeId(null)} />
        <div className="drop-hint">Drop files to add them to the canvas</div>
        {selectedIds.length > 1 ? (
          <div className="selection-toolbar">
            <button title="Copy Selection Context" onClick={copySelectedContext}>
              <Clipboard size={16} />
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
          </div>
        ) : null}

        <SelectionActionsContext.Provider value={selectionActions}>
          <ReactFlow
            nodes={nodes}
            edges={emptyEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStart={() => setNodeDragging(true)}
            onNodeDragStop={(_, __, currentNodes) => {
              setNodeDragging(false);
              void persistCanvas(currentNodes as CanvasNode[]);
            }}
            onNodeDrag={() => {
              if (!nodeDragging) setNodeDragging(true);
            }}
            onNodeDoubleClick={(_, node) => setInspectorNodeId(node.id)}
            onSelectionChange={onSelectionChange}
            panOnScroll
            panOnScrollSpeed={1}
            panOnScrollMode={PanOnScrollMode.Free}
            panOnDrag={[1, 2]}
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
            deleteKeyCode={inspectorNode ? null : ["Backspace", "Delete"]}
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

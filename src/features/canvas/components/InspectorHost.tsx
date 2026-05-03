"use client";

import { X } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";

import { rawUrl, readText } from "../fileApi";
import type { CanvasNode } from "../types";
import { MarkdownEditor } from "./MarkdownEditor";
import { sourceIcons } from "./sourceIcons";
import { VideoPreview } from "./VideoPreview";

function ImagePreviewInspector({ node }: { node: CanvasNode }) {
  return (
    <div className="image-preview-pane">
      <img className="inspector-image" src={rawUrl(node.data.path)} alt={node.data.title} draggable={false} />
    </div>
  );
}

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AssetDetails({ node }: { node: CanvasNode }) {
  const asset = node.data.asset;
  if (!asset) return null;
  const items = [
    asset.format ? `.${asset.format}` : "",
    asset.width && asset.height ? `${asset.width} x ${asset.height}` : "",
    asset.durationSeconds ? `${asset.durationSeconds.toFixed(1)}s` : "",
    asset.words !== undefined ? `${asset.words} words` : "",
    formatBytes(asset.sizeBytes)
  ].filter(Boolean);

  return (
    <section className="asset-details">
      {items.length ? <p>{items.join(" · ")}</p> : null}
      {asset.title ? <p>{asset.title}</p> : null}
      {asset.description ? <p>{asset.description}</p> : null}
    </section>
  );
}

function InspectorContent({ node, boardId }: { node: CanvasNode; boardId: string }) {
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
        <MarkdownEditor id={node.id} data={{ ...node.data, content }} boardId={boardId} onBindSave={() => undefined} />
      </div>
    );
  }

  if (node.data.sourceType === "image") {
    return <ImagePreviewInspector node={node} />;
  }

  if (node.data.sourceType === "video") {
    return <VideoPreview className="inspector-media" src={rawUrl(node.data.path)} title={node.data.title} />;
  }

  if (node.data.sourceType === "prompt") {
    return <pre className="inspector-text">{node.data.content ?? ""}</pre>;
  }

  return <pre className="inspector-text">{content || status || node.data.path}</pre>;
}

const InspectorDrawer = memo(function InspectorDrawer({
  node,
  boardId,
  closing,
  onClose,
  onExitComplete
}: {
  node: CanvasNode;
  boardId: string;
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
        <InspectorContent node={node} boardId={boardId} />
      </section>
      <AssetDetails node={node} />
    </aside>
  );
});

export const InspectorHost = memo(function InspectorHost({ node, boardId, onClose }: { node: CanvasNode | null; boardId: string; onClose: () => void }) {
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

  return <InspectorDrawer node={renderedNode} boardId={boardId} closing={closing} onClose={onClose} onExitComplete={completeExit} />;
});

"use client";

import type { NodeProps } from "@xyflow/react";
import { FileCode2, Save, Video } from "lucide-react";
import { memo, useEffect, useState } from "react";

import { rawUrl, readText, writeText } from "../fileApi";
import type { CanvasNode } from "../types";
import { MarkdownPreview } from "./MarkdownPreview";
import { NodeShell } from "./NodeShell";
import { VideoPreview } from "./VideoPreview";

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
          icon: <FileCode2 size={15} />,
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
        <VideoPreview className="media-video nowheel nodrag nopan" src={rawUrl(data.path)} title={data.title} />
      ) : (
        <button className="media-placeholder video-placeholder" onMouseEnter={() => setArmed(true)} onFocus={() => setArmed(true)}>
          <Video size={34} />
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

export const nodeTypes = {
  markdown: MarkdownNode,
  html: HtmlNode,
  image: ImageNode,
  video: VideoNode,
  prompt: PromptNode,
  file: FileNode
};

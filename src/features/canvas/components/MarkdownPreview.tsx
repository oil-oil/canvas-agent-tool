"use client";

import { useEffect, useState } from "react";

import { readText } from "../fileApi";
import { markdownToHtml } from "../html";
import type { CanvasNodeData } from "../types";

export function MarkdownPreview({ id, data }: { id: string; data: CanvasNodeData }) {
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

import type { CanvasComment } from "./types";

export async function fetchComments(boardId: string, nodeId: string) {
  const response = await fetch(`/api/comments?board=${encodeURIComponent(boardId)}&node=${encodeURIComponent(nodeId)}`);
  const payload: { comments?: CanvasComment[]; error?: string } = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Could not load comments.");
  return payload.comments ?? [];
}

export async function createNodeComment(input: {
  boardId: string;
  nodeId: string;
  path?: string;
  title?: string;
  quote: string;
  comment: string;
}) {
  const response = await fetch("/api/comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload: { comment?: CanvasComment; error?: string } = await response.json();
  if (!response.ok || !payload.comment) throw new Error(payload.error ?? "Could not add comment.");
  return payload.comment;
}

export async function resolveNodeComment(id: string) {
  const response = await fetch("/api/comments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "resolve", id })
  });
  const payload: { comment?: CanvasComment; error?: string } = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Could not resolve comment.");
  return payload.comment;
}

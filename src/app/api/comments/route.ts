import { NextResponse } from "next/server";
import { createComment, getCurrentBoard, listComments, resolveComment } from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const boardId = url.searchParams.get("board") ?? (await getCurrentBoard())?.id;
    const nodeId = url.searchParams.get("node") ?? undefined;
    const path = url.searchParams.get("path") ?? undefined;
    const status = (url.searchParams.get("status") as "open" | "resolved" | null) ?? "open";
    const comments = await listComments({ boardId, nodeId, path, status });
    return NextResponse.json({ comments });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    if (payload?.action === "resolve") {
      const comment = await resolveComment(String(payload.id ?? ""));
      return NextResponse.json({ comment });
    }

    const comment = await createComment({
      boardId: String(payload.boardId ?? ""),
      nodeId: String(payload.nodeId ?? ""),
      path: payload.path ? String(payload.path) : undefined,
      title: payload.title ? String(payload.title) : undefined,
      quote: String(payload.quote ?? ""),
      comment: String(payload.comment ?? "")
    });
    return NextResponse.json({ comment });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

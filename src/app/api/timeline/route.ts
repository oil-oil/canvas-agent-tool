import { NextResponse } from "next/server";
import { getCurrentBoard, listTimeline, recordTimelineEvent } from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const boardId = url.searchParams.get("board") ?? (await getCurrentBoard())?.id;
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const events = await listTimeline({ boardId, limit });
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { text?: string; boardId?: string };
    const board = await getCurrentBoard();
    const event = await recordTimelineEvent({
      type: "note",
      boardId: payload.boardId || board?.id,
      text: String(payload.text ?? "").trim()
    });
    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

import { promises as fs } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { assertAllowedPath, getCurrentBoard, recordTimelineEvent } from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const filePath = request.nextUrl.searchParams.get("path") ?? "";
    const resolved = await assertAllowedPath(filePath);
    const content = await fs.readFile(resolved, "utf8");
    return NextResponse.json({ path: resolved, content });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { path?: string; content?: string };
    const resolved = await assertAllowedPath(body.path ?? "");
    await fs.writeFile(resolved, body.content ?? "", "utf8");
    const board = await getCurrentBoard();
    await recordTimelineEvent({ type: "file.write", boardId: board?.id, path: resolved, title: resolved.split("/").pop(), details: { bytes: Buffer.byteLength(body.content ?? "", "utf8") } });
    return NextResponse.json({ ok: true, path: resolved });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

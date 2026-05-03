import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { filesRoot, getCurrentBoard, recordTimelineEvent, resolveUserPath } from "@/lib/canvasStore";

export const runtime = "nodejs";

function safeName(input: string) {
  return input.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { target?: string; name?: string };
    const target = resolveUserPath(body.target ?? "");
    await fs.access(target);

    const linkName = safeName(body.name || path.basename(target));
    const linkPath = path.join(filesRoot, linkName);
    await fs.symlink(target, linkPath);
    const board = await getCurrentBoard();
    await recordTimelineEvent({ type: "file.link", boardId: board?.id, path: linkPath, title: linkName, details: { target } });

    return NextResponse.json({ ok: true, linkPath, target });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

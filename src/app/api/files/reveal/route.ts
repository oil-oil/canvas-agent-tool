import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { filesRoot, resolveUserPath } from "@/lib/canvasStore";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { path?: string };
    const target = body.path ? resolveUserPath(body.path) : filesRoot;
    const stat = await fs.stat(target);
    const folder = stat.isDirectory() ? target : path.dirname(target);
    await execFileAsync("open", [folder]);
    return NextResponse.json({ ok: true, path: folder });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

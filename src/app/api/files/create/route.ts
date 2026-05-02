import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { filesRoot, inferSourceType } from "@/lib/canvasStore";

export const runtime = "nodejs";

async function uniquePath(directory: string, name: string) {
  const parsed = path.parse(name);
  let candidate = path.join(directory, `${parsed.name}${parsed.ext}`);
  let index = 1;

  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(directory, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

export async function POST() {
  try {
    const notesRoot = path.join(filesRoot, "notes");
    await fs.mkdir(notesRoot, { recursive: true });
    const targetPath = await uniquePath(notesRoot, `untitled-${Date.now()}.md`);
    await fs.writeFile(targetPath, "", "utf8");

    return NextResponse.json({
      ok: true,
      title: path.basename(targetPath),
      path: targetPath,
      sourceType: inferSourceType(targetPath)
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

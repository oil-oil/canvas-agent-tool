import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { filesRoot, getAssetMetadata, getCurrentBoard, inferSourceType, isRenderableSourceType, recordTimelineEvent } from "@/lib/canvasStore";

export const runtime = "nodejs";

function safeName(input: string) {
  const cleaned = input.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return cleaned || `file-${Date.now()}`;
}

async function uniquePath(directory: string, name: string) {
  const parsed = path.parse(safeName(name));
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

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    const sourceType = inferSourceType(file.name);
    if (!isRenderableSourceType(sourceType)) {
      return NextResponse.json({ error: "Only image, video, HTML, and Markdown files are supported." }, { status: 400 });
    }

    const dropsRoot = path.join(filesRoot, "drops");
    await fs.mkdir(dropsRoot, { recursive: true });
    const targetPath = await uniquePath(dropsRoot, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(targetPath, buffer);
    const asset = await getAssetMetadata(targetPath);
    const board = await getCurrentBoard();
    await recordTimelineEvent({ type: "file.upload", boardId: board?.id, path: targetPath, title: path.basename(targetPath), details: { sourceType, sizeBytes: asset.sizeBytes } });

    return NextResponse.json({
      ok: true,
      title: path.basename(targetPath),
      path: targetPath,
      sourceType,
      asset
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { canvasFile, canvasRoot, filesRoot, workspaceRoot } from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    workspaceRoot,
    canvasRoot,
    filesRoot,
    canvasFile
  });
}

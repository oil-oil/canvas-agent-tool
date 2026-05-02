import { NextResponse } from "next/server";
import { boardsRoot, canvasFile, canvasRoot, filesRoot, getCurrentBoard, stateFile, workspaceRoot } from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET() {
  const currentBoard = await getCurrentBoard();
  return NextResponse.json({
    workspaceRoot,
    canvasRoot,
    boardsRoot,
    filesRoot,
    canvasFile,
    stateFile,
    currentBoard
  });
}

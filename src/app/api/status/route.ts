import { NextResponse } from "next/server";
import { boardsRoot, canvasFile, canvasRoot, commentsFile, filesRoot, getCurrentBoard, stateFile, workspaceRoot } from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET() {
  const currentBoard = await getCurrentBoard();
  return NextResponse.json({
    workspaceRoot,
    canvasRoot,
    boardsRoot,
    filesRoot,
    canvasFile,
    commentsFile,
    stateFile,
    currentBoard
  });
}

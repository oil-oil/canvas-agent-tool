import { NextResponse } from "next/server";
import {
  boardsRoot,
  canvasFile,
  canvasRoot,
  commentsFile,
  filesRoot,
  getCurrentBoard,
  metaFile,
  miraHome,
  sourceWorkspaceRoot,
  stateFile,
  storageMode,
  timelineFile,
  workspaceRoot
} from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET() {
  const currentBoard = await getCurrentBoard();
  return NextResponse.json({
    miraHome,
    storageMode,
    sourceWorkspaceRoot,
    workspaceRoot,
    canvasRoot,
    boardsRoot,
    filesRoot,
    metaFile,
    canvasFile,
    commentsFile,
    timelineFile,
    stateFile,
    currentBoard
  });
}

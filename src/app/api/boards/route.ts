import { NextResponse } from "next/server";
import { createBoard, listBoards, setCurrentBoard } from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listBoards());
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    if (payload?.action === "create") {
      const board = await createBoard(String(payload.title ?? ""));
      return NextResponse.json({ board, ...(await listBoards()) });
    }

    if (payload?.action === "use") {
      const board = await setCurrentBoard(String(payload.boardId ?? ""));
      return NextResponse.json({ board, ...(await listBoards()) });
    }

    return NextResponse.json({ error: "Unsupported board action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

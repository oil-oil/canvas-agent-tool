import { NextResponse } from "next/server";
import { readCanvas, writeCanvas } from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await readCanvas(url.searchParams.get("board") ?? undefined));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const document = await request.json();
    const board = await writeCanvas(document, url.searchParams.get("board") ?? undefined);
    return NextResponse.json({ ok: true, board });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

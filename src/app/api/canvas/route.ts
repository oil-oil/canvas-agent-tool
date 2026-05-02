import { NextResponse } from "next/server";
import { readCanvas, writeCanvas } from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await readCanvas());
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const document = await request.json();
    await writeCanvas(document);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { scanCanvasFiles } from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ files: await scanCanvasFiles() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

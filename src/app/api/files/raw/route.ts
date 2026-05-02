import { promises as fs } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { assertAllowedPath, contentTypeFor } from "@/lib/canvasStore";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const filePath = request.nextUrl.searchParams.get("path") ?? "";
    const resolved = await assertAllowedPath(filePath);
    const buffer = await fs.readFile(resolved);
    return new Response(buffer, {
      headers: {
        "content-type": contentTypeFor(resolved),
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

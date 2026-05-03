import { addMiraEventClient, notifyMiraChange, startMiraWatcher } from "@/lib/miraEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  startMiraWatcher();
  let removeClient: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      removeClient = addMiraEventClient(controller);
      heartbeat = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
      }, 25000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      removeClient?.();
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive"
    }
  });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { boardId?: string; reason?: string; path?: string };
  notifyMiraChange({
    boardId: payload.boardId,
    path: payload.path,
    reason: payload.reason ?? "manual"
  });
  return Response.json({ ok: true });
}

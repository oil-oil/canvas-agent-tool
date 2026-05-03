export async function writeClipboardPayload(payload: { plain: string; html?: string }) {
  if (payload.html && "ClipboardItem" in window && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([payload.plain], { type: "text/plain" }),
        "text/html": new Blob([payload.html], { type: "text/html" })
      })
    ]);
    return;
  }
  await navigator.clipboard.writeText(payload.plain);
}

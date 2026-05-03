import { supportedDropExtensions } from "./constants";
import type { UploadedFile } from "./types";

export function rawUrl(path?: string) {
  return path ? `/api/files/raw?path=${encodeURIComponent(path)}` : "";
}

export function fileExtension(name: string) {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
}

export function isSupportedFile(file: File) {
  return supportedDropExtensions.has(fileExtension(file.name));
}

export async function uploadCanvasFiles(input: FileList | File[]) {
  const files = Array.from(input).filter(isSupportedFile);
  if (!files.length) {
    throw new Error("Choose image, video, HTML, or Markdown files.");
  }
  return Promise.all(
    files.map(async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Import failed");
      return payload as UploadedFile;
    })
  );
}

export async function createMarkdownFile() {
  const response = await fetch("/api/files/create", { method: "POST" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Create failed");
  return payload as UploadedFile;
}

export async function readText(path?: string) {
  if (!path) return "";
  const response = await fetch(`/api/files/content?path=${encodeURIComponent(path)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Read failed");
  return payload.content as string;
}

export async function writeText(path: string | undefined, content: string) {
  if (!path) return;
  const response = await fetch("/api/files/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, content })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Save failed");
}

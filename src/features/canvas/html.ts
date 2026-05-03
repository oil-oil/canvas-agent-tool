import { marked } from "marked";

import { rawUrl } from "./fileApi";
import type { UploadedFile } from "./types";

export function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeHtmlText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function markdownToHtml(markdown: string) {
  return marked.parse(markdown, { async: false }) as string;
}

export function htmlForMarkdownDrop(file: UploadedFile) {
  const src = rawUrl(file.path);
  const title = escapeHtmlAttribute(file.title);
  if (file.sourceType === "image") {
    return `<p><img src="${src}" alt="${title}"></p>`;
  }
  if (file.sourceType === "video") {
    return `<video src="${src}" title="${title}" controls></video>`;
  }
  if (file.sourceType === "html") {
    return `<iframe src="${src}" title="${title}"></iframe>`;
  }
  return `<p>${title}</p>`;
}

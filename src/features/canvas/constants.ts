import type { Edge } from "@xyflow/react";

import type { SourceType } from "./types";

export const emptyEdges: Edge[] = [];
export const snapGrid: [number, number] = [24, 24];
export const arrangeGap = 48;
export const arrangeRowGap = 64;

export const defaultNodeSizes: Record<SourceType, { width: number; height: number }> = {
  markdown: { width: 720, height: 820 },
  html: { width: 960, height: 600 },
  image: { width: 260, height: 220 },
  video: { width: 300, height: 210 },
  prompt: { width: 420, height: 320 },
  file: { width: 300, height: 230 }
};

export const viewportPresets = {
  phone: { label: "Phone", width: 390, height: 844 },
  tablet: { label: "Tablet", width: 768, height: 1024 },
  desktop: { label: "Desktop", width: 1280, height: 800 }
} as const;

export type ViewportPreset = keyof typeof viewportPresets;

export const supportedFileAccept = [
  ".md",
  ".mdx",
  ".markdown",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  "image/*",
  "video/*",
  "text/html",
  "text/markdown"
].join(",");

export const supportedDropExtensions = new Set([
  ".md",
  ".mdx",
  ".markdown",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".mp4",
  ".webm",
  ".mov",
  ".m4v"
]);

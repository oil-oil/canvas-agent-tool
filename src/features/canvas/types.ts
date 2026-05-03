import type { Edge, Node as FlowNode } from "@xyflow/react";
import type { ReactNode } from "react";

export type SourceType = "markdown" | "html" | "image" | "video" | "prompt" | "file";

export type AssetMetadata = {
  format?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  title?: string;
  words?: number;
  description?: string;
  updatedAt?: string;
};

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  action: () => void | Promise<void>;
  danger?: boolean;
  shortcut?: string[];
};

export type CanvasNodeData = {
  title: string;
  path?: string;
  content?: string;
  sourceType: SourceType;
  summary?: string;
  asset?: AssetMetadata;
  preview?: boolean;
  width?: number;
  height?: number;
  onUpdate?: (id: string, patch: Partial<CanvasNodeData>) => void;
  onResize?: (id: string, size: { width: number; height: number }, options?: { persist?: boolean }) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onCopyContext?: (id: string) => void;
  onCopyContent?: (id: string) => void;
  onCopyPath?: (id: string) => void;
  onHistory?: () => void;
};

export type UploadedFile = {
  title: string;
  path: string;
  sourceType: SourceType;
  asset?: AssetMetadata;
};

export type CanvasNode = FlowNode<CanvasNodeData>;

export type CanvasDocument = {
  nodes: CanvasNode[];
  edges?: Edge[];
};

export type CanvasComment = {
  id: string;
  boardId: string;
  nodeId: string;
  path?: string;
  title?: string;
  quote: string;
  comment: string;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
};

export type CanvasBoard = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type SelectionActions = {
  selectedCount: number;
  copySelectedContent: () => void;
  copySelectedPath: () => void;
  copySelectedContext: () => void;
  arrangeSelected: () => void;
  deleteSelected: () => void;
};

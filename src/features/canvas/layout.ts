import { arrangeGap, arrangeRowGap, defaultNodeSizes } from "./constants";
import type { CanvasNode } from "./types";

const layoutTypeOrder = new Map([
  ["image", 0],
  ["video", 1],
  ["markdown", 2],
  ["html", 3],
  ["prompt", 4],
  ["file", 5]
]);

export function stripRuntimeData(nodes: CanvasNode[]) {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: {
      title: node.data.title,
      path: node.data.path,
      content: node.data.content,
      sourceType: node.data.sourceType,
      summary: node.data.summary,
      asset: node.data.asset,
      preview: node.data.preview,
      width: node.data.width,
      height: node.data.height
    }
  }));
}

export function sizeNode(node: CanvasNode, size: { width: number; height: number }): CanvasNode {
  return {
    ...node,
    width: size.width,
    height: size.height,
    measured: {
      width: size.width,
      height: size.height
    },
    style: {
      ...node.style,
      width: size.width,
      height: size.height
    },
    data: {
      ...node.data,
      width: size.width,
      height: size.height
    }
  };
}

function withoutRuntimeSize(node: CanvasNode): CanvasNode {
  const next: CanvasNode = {
    ...node,
    data: { ...node.data }
  };
  delete next.width;
  delete next.height;
  delete next.initialWidth;
  delete next.initialHeight;
  delete next.measured;
  delete next.resizing;

  if (next.style) {
    const { width, height, ...style } = next.style;
    next.style = Object.keys(style).length ? style : undefined;
  }

  return next;
}

export function normalizeStoredNode(node: CanvasNode): CanvasNode {
  const clean = withoutRuntimeSize(node);
  const data = { ...clean.data };

  if (data.sourceType === "markdown" && data.width === 520 && data.height === 460) {
    data.width = defaultNodeSizes.markdown.width;
    data.height = defaultNodeSizes.markdown.height;
  }

  if (data.sourceType === "html" && data.width === 720 && data.height === 450) {
    data.width = defaultNodeSizes.html.width;
    data.height = defaultNodeSizes.html.height;
  }

  const normalized = { ...clean, data };
  if (data.width && data.height) {
    return sizeNode(normalized, { width: data.width, height: data.height });
  }

  return normalized;
}

export function snapshotNodes(nodes: CanvasNode[]) {
  return stripRuntimeData(nodes) as CanvasNode[];
}

export function estimateNodeSize(node: CanvasNode) {
  if (node.data.width && node.data.height) {
    return { width: node.data.width, height: node.data.height + 32 };
  }

  if (node.width && node.height) {
    return { width: node.width, height: node.height + 32 };
  }

  if (node.measured?.width && node.measured.height) {
    return { width: node.measured.width, height: node.measured.height + 32 };
  }

  const fallback = defaultNodeSizes[node.data.sourceType];
  return { width: fallback.width, height: fallback.height + 32 };
}

export function orderedNodesForLayout(nodes: CanvasNode[]) {
  return [...nodes].sort(sortByPosition);
}

function sortByPosition(a: CanvasNode, b: CanvasNode) {
  const rowDelta = a.position.y - b.position.y;
  if (Math.abs(rowDelta) > 80) return rowDelta;
  return a.position.x - b.position.x;
}

export function orderedNodesForGroupedLayout(nodes: CanvasNode[]) {
  return [...nodes].sort((a, b) => {
    const typeDelta = (layoutTypeOrder.get(a.data.sourceType) ?? 99) - (layoutTypeOrder.get(b.data.sourceType) ?? 99);
    if (typeDelta) return typeDelta;
    return sortByPosition(a, b);
  });
}

export function computeTypeGroups(nodes: CanvasNode[]) {
  const ordered = orderedNodesForGroupedLayout(nodes);
  const groups: CanvasNode[][] = [];

  for (const node of ordered) {
    const last = groups.at(-1);
    if (last?.[0]?.data.sourceType === node.data.sourceType) {
      last.push(node);
    } else {
      groups.push([node]);
    }
  }

  return groups;
}

export function measureLayoutRows(rows: CanvasNode[][]) {
  return rows.map((row) => {
    const sizes = row.map(estimateNodeSize);
    return {
      width: sizes.reduce((sum, size) => sum + size.width, 0) + Math.max(0, row.length - 1) * arrangeGap,
      height: Math.max(...sizes.map((size) => size.height))
    };
  });
}

export function measureRows(nodes: CanvasNode[], columns: number) {
  const rows: CanvasNode[][] = [];
  for (let index = 0; index < nodes.length; index += columns) {
    rows.push(nodes.slice(index, index + columns));
  }

  const rowSizes = measureLayoutRows(rows);

  return {
    rows,
    width: Math.max(...rowSizes.map((row) => row.width)),
    height: rowSizes.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * arrangeRowGap,
    rowSizes
  };
}

export function chooseSmartColumns(nodes: CanvasNode[]) {
  const ordered = orderedNodesForLayout(nodes);
  if (ordered.length <= 1) return 1;
  const targetRatio = 1.48;
  const maxColumns = Math.min(ordered.length, Math.max(2, Math.ceil(Math.sqrt(ordered.length)) + 2));
  let best = { columns: 1, score: Number.POSITIVE_INFINITY };

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const measured = measureRows(ordered, columns);
    const ratio = measured.width / Math.max(1, measured.height);
    const balancePenalty = Math.abs(targetRatio - ratio);
    const emptySlots = Math.ceil(ordered.length / columns) * columns - ordered.length;
    const score = balancePenalty + emptySlots * 0.08 + measured.height / 10000;
    if (score < best.score) {
      best = { columns, score };
    }
  }

  return best.columns;
}

export function chooseSmartGroupedColumns(nodes: CanvasNode[]) {
  const groups = computeTypeGroups(nodes);
  const ordered = groups.flat();
  if (ordered.length <= 1) return 1;
  const targetRatio = 1.48;
  const maxGroupSize = Math.max(...groups.map((group) => group.length));
  const maxColumns = Math.min(maxGroupSize, Math.max(2, Math.ceil(Math.sqrt(ordered.length)) + 2));
  let best = { columns: 1, score: Number.POSITIVE_INFINITY };

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const rows = groups.flatMap((group) => {
      const groupRows: CanvasNode[][] = [];
      for (let index = 0; index < group.length; index += columns) {
        groupRows.push(group.slice(index, index + columns));
      }
      return groupRows;
    });
    const rowSizes = measureLayoutRows(rows);
    const width = Math.max(...rowSizes.map((row) => row.width));
    const height = rowSizes.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * arrangeRowGap;
    const ratio = width / Math.max(1, height);
    const emptySlots = groups.reduce((sum, group) => sum + (Math.ceil(group.length / columns) * columns - group.length), 0);
    const score = Math.abs(targetRatio - ratio) + emptySlots * 0.06 + height / 10000;
    if (score < best.score) {
      best = { columns, score };
    }
  }

  return best.columns;
}

function groupedRowsForLayout(nodes: CanvasNode[]) {
  const groups = computeTypeGroups(nodes);
  const columns = chooseSmartGroupedColumns(nodes);
  return groups.flatMap((group) => {
    const rows: CanvasNode[][] = [];
    for (let index = 0; index < group.length; index += columns) {
      rows.push(group.slice(index, index + columns));
    }
    return rows;
  });
}

export function computeSmartLayout(nodes: CanvasNode[], origin?: { x: number; y: number }) {
  const rows = groupedRowsForLayout(nodes);
  const ordered = rows.flat();
  if (!ordered.length) return new Map<string, { x: number; y: number }>();

  const left = origin?.x ?? Math.min(...ordered.map((node) => node.position.x));
  const top = origin?.y ?? Math.min(...ordered.map((node) => node.position.y));
  const rowSizes = measureLayoutRows(rows);
  const positions = new Map<string, { x: number; y: number }>();
  let cursorY = top;

  for (const [rowIndex, row] of rows.entries()) {
    const rowHeight = rowSizes[rowIndex].height;
    let cursorX = left;
    for (const node of row) {
      const size = estimateNodeSize(node);
      positions.set(node.id, { x: cursorX, y: cursorY });
      cursorX += size.width + arrangeGap;
    }
    cursorY += rowHeight + arrangeRowGap;
  }

  return positions;
}

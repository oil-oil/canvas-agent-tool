"use client";

import * as ContextMenu from "@radix-ui/react-context-menu";
import { NodeResizer } from "@xyflow/react";
import { Clipboard, Copy, LayoutGrid, Link2, Trash2 } from "lucide-react";
import { useCallback, useContext, useMemo } from "react";

import type { CanvasNodeData, MenuItem } from "../types";
import { SelectionActionsContext } from "./selectionActionsContext";
import { sourceIcons } from "./sourceIcons";

function NodeContextMenu({
  children,
  items
}: {
  children: React.ReactNode;
  items: MenuItem[];
}) {
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu">
          {items.map((item, index) => (
            <ContextMenu.Item
              key={`${item.label}-${index}`}
              className={item.danger ? "context-menu-item danger" : "context-menu-item"}
              onSelect={item.action}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.shortcut?.length ? (
                <span className="context-shortcut">
                  {item.shortcut.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </span>
              ) : null}
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function defaultMenuItems(id: string, data: CanvasNodeData, extra: MenuItem[] = []) {
  return [
    ...extra,
    {
      label: "Copy Content",
      icon: <Clipboard size={15} />,
      shortcut: ["Ctrl", "C"],
      action: () => data.onCopyContent?.(id)
    },
    {
      label: "Copy Path",
      icon: <Link2 size={15} />,
      shortcut: ["Ctrl", "C", "C"],
      action: () => data.onCopyPath?.(id)
    },
    {
      label: "Copy Context",
      icon: <Copy size={15} />,
      action: () => data.onCopyContext?.(id)
    },
    {
      label: "Duplicate Node",
      icon: <Copy size={15} />,
      action: () => data.onDuplicate?.(id)
    },
    {
      label: "Delete",
      icon: <Trash2 size={15} />,
      action: () => data.onDelete?.(id),
      danger: true
    }
  ];
}

export function NodeShell({
  id,
  data,
  children,
  className = "",
  menuItems = [],
  selected = false
}: {
  id: string;
  data: CanvasNodeData;
  children: React.ReactNode;
  className?: string;
  menuItems?: MenuItem[];
  selected?: boolean;
}) {
  const selectionActions = useContext(SelectionActionsContext);
  const minSize = useMemo(() => {
    if (data.sourceType === "image" || data.sourceType === "video") {
      return { width: 120, height: 92 };
    }
    if (data.sourceType === "file") {
      return { width: 170, height: 118 };
    }
    return { width: 220, height: 160 };
  }, [data.sourceType]);
  const nodeStyle = useMemo(
    () => ({
      width: data.width ? `${data.width}px` : undefined,
      height: data.height ? `${data.height}px` : undefined
    }),
    [data.height, data.width]
  );
  const resize = useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      data.onResize?.(id, { width: Math.round(params.width), height: Math.round(params.height) });
    },
    [data, id]
  );
  const finishResize = useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      data.onResize?.(id, { width: Math.round(params.width), height: Math.round(params.height) }, { persist: true });
    },
    [data, id]
  );
  const startResize = useCallback(() => {
    data.onHistory?.();
  }, [data]);
  const items = useMemo(() => {
    const batchItems: MenuItem[] =
      selected && selectionActions && selectionActions.selectedCount > 1
        ? [
            {
              label: "Copy Selection Content",
              icon: <Clipboard size={15} />,
              action: selectionActions.copySelectedContent
            },
            {
              label: "Copy Selection Paths",
              icon: <Link2 size={15} />,
              action: selectionActions.copySelectedPath
            },
            {
              label: "Copy Selection Context",
              icon: <Copy size={15} />,
              action: selectionActions.copySelectedContext
            },
            {
              label: "Smart Arrange",
              icon: <LayoutGrid size={15} />,
              action: selectionActions.arrangeSelected
            },
            {
              label: "Delete Selection",
              icon: <Trash2 size={15} />,
              action: selectionActions.deleteSelected,
              danger: true
            }
          ]
        : [];
    return defaultMenuItems(id, data, [...batchItems, ...menuItems]);
  }, [data, id, menuItems, selected, selectionActions]);

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={minSize.width}
        minHeight={minSize.height}
        keepAspectRatio={data.sourceType === "image" || data.sourceType === "video"}
        autoScale
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
        onResizeStart={startResize}
        onResize={resize}
        onResizeEnd={finishResize}
      />
      <NodeContextMenu items={items}>
        <div className="node-frame">
          <div className="node-caption">
            <span>{sourceIcons[data.sourceType]}</span>
            <strong>{data.title}</strong>
          </div>
          <section className={`canvas-node ${data.sourceType} ${className} ${data.width || data.height ? "is-sized" : ""}`} style={nodeStyle}>
            {children}
          </section>
        </div>
      </NodeContextMenu>
    </>
  );
}

"use client";

import { FilePlus2, FileText, Plus } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { supportedFileAccept } from "../constants";

export const CanvasToolbar = memo(function CanvasToolbar({
  onAddFiles,
  onAddMarkdown
}: {
  onAddFiles: (files: FileList) => void;
  onAddMarkdown: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => window.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  const chooseFiles = useCallback(() => {
    setOpen(false);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.currentTarget.files?.length) {
        onAddFiles(event.currentTarget.files);
      }
      event.currentTarget.value = "";
    },
    [onAddFiles]
  );

  const addMarkdown = useCallback(() => {
    setOpen(false);
    onAddMarkdown();
  }, [onAddMarkdown]);

  return (
    <section className="canvas-toolbar" ref={toolbarRef}>
      <button className="toolbar-trigger" title="Add Content" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <Plus size={17} />
        <span>Add Content</span>
      </button>
      {open ? (
        <div className="toolbar-menu">
          <button onClick={chooseFiles}>
            <FilePlus2 size={15} />
            <span>Add Files</span>
          </button>
          <button onClick={addMarkdown}>
            <FileText size={16} />
            <span>New Markdown</span>
          </button>
        </div>
      ) : null}
      <input ref={fileInputRef} className="hidden-file-input" type="file" multiple accept={supportedFileAccept} onChange={handleFileChange} />
    </section>
  );
});

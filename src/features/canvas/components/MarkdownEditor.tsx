"use client";

import { Mark, Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Check, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TurndownService from "turndown";

import { createNodeComment, fetchComments, resolveNodeComment } from "../commentsApi";
import { isSupportedFile, readText, uploadCanvasFiles, writeText } from "../fileApi";
import { htmlForMarkdownDrop, markdownToHtml } from "../html";
import type { CanvasComment, CanvasNodeData } from "../types";

const TiptapVideo = TiptapNode.create({
  name: "mediaVideo",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      title: { default: null }
    };
  },
  parseHTML() {
    return [{ tag: "video[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["video", mergeAttributes(HTMLAttributes, { controls: "true" })];
  }
});

const TiptapIframe = TiptapNode.create({
  name: "htmlEmbed",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      title: { default: null }
    };
  },
  parseHTML() {
    return [{ tag: "iframe[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["iframe", mergeAttributes(HTMLAttributes, { loading: "lazy" })];
  }
});

const CommentHighlight = Mark.create({
  name: "commentHighlight",
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-id"),
        renderHTML: (attributes) => (attributes.commentId ? { "data-comment-id": attributes.commentId } : {})
      }
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "comment-highlight" }), 0];
  }
});

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function MarkdownEditor({
  id,
  data,
  boardId,
  onBindSave
}: {
  id: string;
  data: CanvasNodeData;
  boardId: string;
  onBindSave: (save?: () => Promise<void>) => void;
}) {
  const [status, setStatus] = useState("");
  const [comments, setComments] = useState<CanvasComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const [selectionBubble, setSelectionBubble] = useState<{
    from: number;
    to: number;
    quote: string;
    left: number;
    top: number;
  } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const turndown = useMemo(() => {
    const service = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced"
    });
    service.addRule("commentHighlight", {
      filter: (node) => node.nodeName === "SPAN" && (node as HTMLElement).hasAttribute("data-comment-id"),
      replacement: (content) => content
    });
    service.addRule("video", {
      filter: "video",
      replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`
    });
    service.addRule("iframe", {
      filter: "iframe",
      replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`
    });
    return service;
  }, []);
  const editor = useEditor({
    extensions: [StarterKit, Image, TiptapVideo, TiptapIframe, CommentHighlight],
    content: "",
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setStatus("Unsaved changes");
      saveTimerRef.current = setTimeout(async () => {
        const markdown = turndown.turndown(editor.getHTML());
        setStatus("Saving");
        await writeText(data.path, markdown);
        data.onUpdate?.(id, { content: markdown });
        setStatus("Saved");
      }, 900);
    },
    editorProps: {
      attributes: {
        class: "tiptap-body nowheel nodrag nopan"
      }
    }
  });

  const refreshComments = useCallback(() => {
    fetchComments(boardId, id)
      .then(setComments)
      .catch((error) => setStatus(error.message));
  }, [boardId, id]);

  useEffect(() => {
    refreshComments();
  }, [refreshComments]);

  const updateSelectionBubble = useCallback(() => {
    if (!editor) return null;
    const { from, to } = editor.state.selection;
    const quote = from === to ? "" : editor.state.doc.textBetween(from, to, "\n").trim();
    const host = editorWrapRef.current?.getBoundingClientRect();
    if (!quote || !host) {
      setSelectionBubble(null);
      setCommentOpen(false);
      setCommentDraft("");
      return null;
    }
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const left = clamp((start.left + end.right) / 2 - host.left, 92, Math.max(92, host.width - 92));
    const top = Math.max(8, Math.min(start.top, end.top) - host.top - 10);
    const bubble = { from, to, quote, left, top };
    setSelectionBubble(bubble);
    setCommentOpen(false);
    setCommentDraft("");
    return bubble;
  }, [editor]);

  useEffect(() => {
    let cancelled = false;
    setStatus("");
    readText(data.path)
      .then((markdown) => {
        if (cancelled) return;
        editor?.commands.setContent(markdownToHtml(markdown), { emitUpdate: false });
        data.onUpdate?.(id, { content: markdown });
      })
      .catch((error) => setStatus(error.message));
    return () => {
      cancelled = true;
    };
  }, [data.path, editor, id]);

  const saveSource = useCallback(async () => {
    if (!editor) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const markdown = turndown.turndown(editor.getHTML());
    setStatus("Saving");
    await writeText(data.path, markdown);
    data.onUpdate?.(id, { content: markdown });
    setStatus("Saved");
  }, [data, editor, id, turndown]);

  useEffect(() => {
    onBindSave(saveSource);
    return () => onBindSave(undefined);
  }, [onBindSave, saveSource]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleAssetDragOver = useCallback((event: React.DragEvent) => {
    const files = Array.from(event.dataTransfer.files).filter((file) => ["image", "video", "text/html", "text/markdown"].some((type) => file.type.startsWith(type)) || isSupportedFile(file));
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleAssetDrop = useCallback(
    async (event: React.DragEvent) => {
      const files = Array.from(event.dataTransfer.files).filter(isSupportedFile);
      if (!editor || !files.length) return;
      event.preventDefault();
      event.stopPropagation();
      setStatus("Inserting files");
      try {
        const uploaded = await uploadCanvasFiles(files);
        const embeddable = uploaded.filter((file) => file.sourceType === "image" || file.sourceType === "video" || file.sourceType === "html");
        if (!embeddable.length) {
          setStatus("This file can be added to the canvas, but not embedded in the editor yet.");
          return;
        }
        editor.chain().focus().insertContent(embeddable.map(htmlForMarkdownDrop).join("")).run();
        setStatus("Inserted");
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [editor]
  );

  const openCommentComposer = useCallback(() => {
    const bubble = selectionBubble ?? updateSelectionBubble();
    if (!bubble) {
      setStatus("Select text before adding a comment");
      return;
    }
    setSelectionBubble(bubble);
    setCommentOpen(true);
  }, [selectionBubble, updateSelectionBubble]);

  const submitComment = useCallback(async () => {
    const bubble = selectionBubble ?? updateSelectionBubble();
    if (!bubble) {
      setStatus("Select text before adding a comment");
      return;
    }
    const text = commentDraft.trim();
    if (!text) {
      setStatus("Write a comment first");
      return;
    }
    setStatus("Adding comment");
    try {
      const comment = await createNodeComment({
        boardId,
        nodeId: id,
        path: data.path,
        title: data.title,
        quote: bubble.quote,
        comment: text
      });
      editor
        ?.chain()
        .focus()
        .setTextSelection({ from: bubble.from, to: bubble.to })
        .setMark("commentHighlight", { commentId: comment.id })
        .setTextSelection(bubble.to)
        .run();
      setComments((items) => items.concat(comment));
      setCommentDraft("");
      setSelectionBubble(null);
      setCommentOpen(false);
      setStatus("Comment added");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }, [boardId, commentDraft, data.path, data.title, editor, id, selectionBubble, updateSelectionBubble]);

  const resolveComment = useCallback(
    async (commentId: string) => {
      setStatus("Resolving comment");
      try {
        await resolveNodeComment(commentId);
        const markType = editor?.schema.marks.commentHighlight;
        if (editor && markType) {
          const transaction = editor.state.tr;
          editor.state.doc.descendants((node, position) => {
            if (!node.isText) return;
            const hasCommentMark = node.marks.some((mark) => mark.type === markType && mark.attrs.commentId === commentId);
            if (hasCommentMark) transaction.removeMark(position, position + node.nodeSize, markType);
          });
          editor.view.dispatch(transaction);
        }
        setComments((items) => items.filter((comment) => comment.id !== commentId));
        setStatus("Comment resolved");
      } catch (error) {
        setStatus((error as Error).message);
      }
    },
    [editor]
  );

  return (
    <>
      <div className="markdown-editor-wrap" ref={editorWrapRef}>
        {selectionBubble ? (
          <div className={commentOpen ? "selection-comment-popover is-open" : "selection-comment-popover"} style={{ left: selectionBubble.left, top: selectionBubble.top }}>
            {commentOpen ? (
              <form
                className="comment-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitComment();
                }}
              >
                <textarea autoFocus value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Add a comment" />
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setCommentOpen(false);
                      setCommentDraft("");
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit">Add</button>
                </div>
              </form>
            ) : (
              <button type="button" className="selection-comment-trigger" onMouseDown={(event) => event.preventDefault()} onClick={openCommentComposer}>
                <MessageCircle size={14} />
                <span>Add Comment</span>
              </button>
            )}
          </div>
        ) : null}
        <EditorContent
          editor={editor}
          className="markdown-editor"
          onDragOver={handleAssetDragOver}
          onDrop={handleAssetDrop}
          onMouseUp={updateSelectionBubble}
          onKeyUp={updateSelectionBubble}
        />
      </div>
      {comments.length ? (
        <section className="comments-panel">
          {comments.map((comment) => (
            <article key={comment.id} className="comment-card">
              <p>{comment.comment}</p>
              <button onClick={() => void resolveComment(comment.id)} title="Resolve comment">
                <Check size={13} />
                <span>Resolve</span>
              </button>
            </article>
          ))}
        </section>
      ) : null}
      {status ? <span className="node-status">{status}</span> : null}
    </>
  );
}

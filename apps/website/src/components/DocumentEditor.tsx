import { Crepe } from "@milkdown/crepe";
import { insert, replaceAll } from "@milkdown/kit/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { deleteDocument, updateDocument } from "../api/documents.ts";
import type { Document } from "../api/documents.ts";

type DocumentDraft = {
  title: string;
  content: string;
};

type DocumentEditorProps = {
  document: Document;
  isCentered?: boolean;
  onDeleted?: () => void;
};

type MilkdownMarkdownEditorProps = {
  documentId: string;
  onChange: (value: string) => void;
  onReady: (api: MilkdownEditorApi) => void;
  value: string;
};

type MilkdownEditorApi = {
  getMarkdown: () => string;
  insertMarkdown: (value: string) => void;
  replaceMarkdown: (value: string, options?: { notify?: boolean }) => void;
};

function MilkdownMarkdownEditor({
  documentId,
  onChange,
  onReady,
  value,
}: MilkdownMarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<MilkdownEditorApi | null>(null);
  const currentMarkdownRef = useRef(value);
  const valueRef = useRef(value);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    let disposed = false;
    const crepe = new Crepe({
      root,
      defaultValue: value,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: "Start writing...",
        },
      },
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        currentMarkdownRef.current = markdown;
        onChange(markdown);
      });
    });

    void crepe.create().then(() => {
      if (disposed) {
        void crepe.destroy();
        return;
      }

      const api: MilkdownEditorApi = {
        getMarkdown: () => crepe.getMarkdown(),
        insertMarkdown: (markdown) => {
          crepe.editor.action(insert(markdown));
          const nextMarkdown = crepe.getMarkdown();
          currentMarkdownRef.current = nextMarkdown;
          onChange(nextMarkdown);
        },
        replaceMarkdown: (markdown, options = {}) => {
          crepe.editor.action(replaceAll(markdown, true));
          const nextMarkdown = crepe.getMarkdown();
          currentMarkdownRef.current = nextMarkdown;
          if (options.notify !== false) {
            onChange(nextMarkdown);
          }
        },
      };

      apiRef.current = api;
      onReady(api);

      if (valueRef.current !== currentMarkdownRef.current) {
        api.replaceMarkdown(valueRef.current, { notify: false });
      }
    });

    return () => {
      disposed = true;
      apiRef.current = null;
      void crepe.destroy();
    };
  }, [documentId]);

  useEffect(() => {
    valueRef.current = value;
    if (value === currentMarkdownRef.current) {
      return;
    }

    if (!apiRef.current) {
      return;
    }

    currentMarkdownRef.current = value;
    apiRef.current.replaceMarkdown(value, { notify: false });
  }, [value]);

  function focusEditorSurface(event: MouseEvent<HTMLDivElement>) {
    const root = rootRef.current;
    const target = event.target;
    if (!root || !(target instanceof Element)) {
      return;
    }

    if (target !== root && !target.classList.contains("milkdown")) {
      return;
    }

    const editor = root.querySelector<HTMLElement>(".ProseMirror");
    if (!editor) {
      return;
    }

    event.preventDefault();
    editor.focus();
  }

  return (
    <div
      ref={rootRef}
      className="onlywrite-milkdown"
      data-testid="document-markdown-editor"
      onMouseDown={focusEditorSurface}
    />
  );
}

export function DocumentEditor({ document, isCentered = true, onDeleted }: DocumentEditorProps) {
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content);
  const [isSaved, setIsSaved] = useState(false);
  const editorApi = useRef<MilkdownEditorApi | null>(null);
  const activeDocumentId = useRef(document.id);
  const titleRef = useRef(document.title);
  const contentRef = useRef(document.content);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const currentDraft = useRef<DocumentDraft>({ title: document.title, content: document.content });

  useEffect(() => {
    setTitle(document.title);
    setContent(document.content);
    setIsSaved(false);
    if (activeDocumentId.current !== document.id) {
      activeDocumentId.current = document.id;
      editorApi.current = null;
    }
    titleRef.current = document.title;
    contentRef.current = document.content;
    currentDraft.current = { title: document.title, content: document.content };
  }, [document]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!saveDocument.isPending && !removeDocument.isPending) {
          saveDocument.mutate(readDraft());
        }
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const saveDocument = useMutation({
    mutationFn: (draft: DocumentDraft) => updateDocument(document.id, draft),
    onSuccess: (updatedDocument, submittedDraft) => {
      void queryClient.invalidateQueries({ queryKey: ["documents"] });

      if (
        currentDraft.current.title === submittedDraft.title &&
        currentDraft.current.content === submittedDraft.content
      ) {
        queryClient.setQueryData(["document", document.id], updatedDocument);
        setIsSaved(true);
      }
    },
  });

  const removeDocument = useMutation({
    mutationFn: () => deleteDocument(document.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["document", document.id], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      onDeleted?.();
      void navigate({ to: "/documents" });
    },
  });

  function readDraft(nextTitle = titleRef.current): DocumentDraft {
    return {
      title: nextTitle,
      content: editorApi.current?.getMarkdown() ?? contentRef.current,
    };
  }

  function commit(nextTitle = titleRef.current, nextContent = contentRef.current) {
    currentDraft.current = { title: nextTitle, content: nextContent };
    setIsSaved(false);
  }

  function handleContentChange(nextContent: string) {
    contentRef.current = nextContent;
    setContent(nextContent);
    commit(titleRef.current, nextContent);
  }

  const statusMessage = saveDocument.isPending
    ? "Saving..."
    : removeDocument.isPending
      ? "Deleting..."
      : isSaved
        ? "Saved"
        : "";
  const errorMessage = removeDocument.isError
    ? "Could not delete document."
    : saveDocument.isError
      ? "Could not save changes."
      : "";

  return (
    <div
      className={
        isCentered
          ? "mx-auto h-[calc(100vh-8rem)] min-h-[620px] w-full max-w-6xl overflow-hidden rounded border border-border bg-surface"
          : "h-full min-h-0 w-full overflow-hidden"
      }
    >
      <article className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto bg-background px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-start gap-3">
          <input
            className="min-w-0 flex-1 border-0 bg-transparent text-3xl font-semibold text-foreground outline-none focus:ring-0"
            value={title}
            onChange={(event) => {
              const nextTitle = event.currentTarget.value;
              titleRef.current = nextTitle;
              setTitle(nextTitle);
              commit(nextTitle, readDraft(nextTitle).content);
            }}
            aria-label="Title"
          />
        </div>

        <div className="mx-auto mt-4 flex min-h-[calc(100vh-12rem)] w-full max-w-5xl flex-1 overflow-hidden rounded border border-border bg-surface">
          <MilkdownMarkdownEditor
            key={document.id}
            documentId={document.id}
            value={content}
            onChange={handleContentChange}
            onReady={(api) => {
              editorApi.current = api;
            }}
          />
        </div>

        <div className="mx-auto mt-3 flex w-full max-w-5xl flex-wrap items-center gap-3 border-t border-border pt-3">
          <div className="min-h-5 text-sm" aria-live="polite">
            {errorMessage ? (
              <span className="text-danger" role="alert">
                {errorMessage}
              </span>
            ) : null}
            {statusMessage && !errorMessage ? (
              <span className={isSaved ? "text-success" : "text-muted"} role="status">
                {statusMessage}
              </span>
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}

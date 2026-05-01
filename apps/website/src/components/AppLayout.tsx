import { Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getDocument, getHealth, listDocuments } from "../api/documents.ts";
import { useAuth } from "../auth.tsx";
import { type ThemeMode, useTheme } from "../theme.tsx";
import { AiComposer, type AiComposerActivity } from "./AiComposer.tsx";

type AgentLaunchRequest = {
  autoSend?: boolean;
  id: number;
  instruction: string;
};

const navigationItems = [
  { icon: "i-lucide-files", label: "Documents", to: "/documents" },
  { icon: "i-lucide-library", label: "Sources", to: "/sources" },
  { icon: "i-lucide-settings", label: "Settings", to: "/settings" },
] as const;

export function AppLayout() {
  const auth = useAuth();
  const { setThemeMode, themeMode } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [isAgentExpanded, setIsAgentExpanded] = useState(false);
  const [agentActivity, setAgentActivity] = useState<AiComposerActivity>({
    isStreaming: false,
    model: "AI",
    preview: "",
    title: "Workspace",
  });
  const [agentLaunchRequest, setAgentLaunchRequest] = useState<AgentLaunchRequest | null>(null);
  const [agentScopeDocumentId, setAgentScopeDocumentId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => getHealth(),
  });
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: () => listDocuments(),
    enabled: isSearchOpen,
  });
  const currentDocumentId = location.pathname.match(/^\/documents\/([^/]+)$/)?.[1];
  const isDocumentWorkspace = /^\/documents\/[^/]+$/.test(location.pathname);
  const isAgentMounted = isAgentOpen || agentActivity.isStreaming;
  const currentDocument = useQuery({
    queryKey: ["document", agentScopeDocumentId],
    queryFn: () => getDocument(agentScopeDocumentId ?? ""),
    enabled: Boolean(isAgentMounted && agentScopeDocumentId),
  });

  const healthText = health.isSuccess
    ? "API online"
    : health.isError
      ? "API offline"
      : "Checking API";
  const agentDocumentId = agentScopeDocumentId
    ? (currentDocument.data?.id ?? agentScopeDocumentId)
    : undefined;
  const agentDraftTitle =
    currentDocument.data?.title ?? (agentDocumentId ? "Document" : "Workspace");
  const profileLabel = auth.user?.name ?? auth.user?.email ?? "Signed in";
  const profileInitial = profileLabel.trim().slice(0, 1).toUpperCase() || "U";
  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return documents.data ?? [];
    }

    return (documents.data ?? []).filter((document) =>
      document.title.toLowerCase().includes(query),
    );
  }, [documents.data, search]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsSearchOpen(true);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    function handleOpenAgent(event: Event) {
      const detail =
        event instanceof CustomEvent && event.detail && typeof event.detail === "object"
          ? (event.detail as Partial<AgentLaunchRequest>)
          : {};
      setAgentScopeDocumentId(currentDocumentId);
      setIsAgentOpen(true);
      if (typeof detail.instruction !== "string" || !detail.instruction.trim()) {
        return;
      }

      setAgentLaunchRequest({
        autoSend: detail.autoSend === true,
        id: Date.now(),
        instruction: detail.instruction,
      });
    }

    window.addEventListener("onlywrite:open-agent", handleOpenAgent);
    return () => window.removeEventListener("onlywrite:open-agent", handleOpenAgent);
  }, [currentDocumentId]);

  useEffect(() => {
    if (isAgentOpen && !agentActivity.isStreaming) {
      setAgentScopeDocumentId(currentDocumentId);
    }
  }, [agentActivity.isStreaming, currentDocumentId, isAgentOpen]);

  const handleAgentActivityChange = useCallback((activity: AiComposerActivity) => {
    setAgentActivity(activity);
  }, []);

  const openAgent = useCallback(() => {
    setAgentScopeDocumentId(currentDocumentId);
    setIsAgentOpen(true);
  }, [currentDocumentId]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="text-base font-semibold text-foreground">
            OnlyWrite
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            {navigationItems.map((item) => {
              const isActive =
                location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded border text-muted hover:bg-surface-secondary hover:text-foreground ${
                    isActive
                      ? "border-accent bg-surface-secondary text-foreground"
                      : "border-border bg-surface"
                  }`}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  title={item.label}
                >
                  <span className={`${item.icon} h-4 w-4`} aria-hidden="true" />
                </Link>
              );
            })}
            <label className="sr-only" htmlFor="theme-mode">
              Theme
            </label>
            <select
              id="theme-mode"
              className="h-8 rounded border border-border bg-field px-2 text-xs text-field-foreground outline-none focus:border-focus"
              value={themeMode}
              onChange={(event) => setThemeMode(event.currentTarget.value as ThemeMode)}
              aria-label="Theme"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              isIconOnly
              type="button"
              onPress={() => setIsSearchOpen(true)}
              aria-label="Search"
            >
              <span className="i-lucide-search h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="rounded border border-border px-2 py-1 text-xs text-muted">
              {healthText}
            </span>
            {auth.enabled ? (
              <div className="flex items-center gap-2">
                <div
                  className="flex h-8 items-center gap-2 rounded border border-border bg-surface pl-1 pr-2 text-xs font-medium text-foreground"
                  title={profileLabel}
                >
                  {auth.user?.picture ? (
                    <img
                      src={auth.user.picture}
                      alt=""
                      className="h-6 w-6 rounded object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-accent text-[11px] text-accent-foreground">
                      {profileInitial}
                    </span>
                  )}
                  <span className="hidden max-w-28 truncate sm:block">{profileLabel}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  isIconOnly
                  type="button"
                  onPress={() => auth.signOut()}
                  aria-label="Sign out"
                >
                  <span className="i-lucide-log-out h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </nav>
        </div>
      </header>
      <main
        className={isDocumentWorkspace ? "w-full px-0 py-0" : "mx-auto w-full max-w-5xl px-4 py-6"}
      >
        <Outlet />
      </main>
      {isAgentMounted ? (
        <div
          className={
            isAgentOpen
              ? `fixed bottom-4 right-4 z-40 overflow-hidden rounded border border-border bg-surface shadow-xl ${
                  isAgentExpanded
                    ? "h-[min(46rem,calc(100vh-2rem))] w-[min(52rem,calc(100vw-2rem))]"
                    : "h-[min(40rem,calc(100vh-2rem))] w-[min(26rem,calc(100vw-2rem))]"
                }`
              : "fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-2rem))]"
          }
        >
          <AiComposer
            documentId={agentDocumentId}
            draftContent={currentDocument.data?.content}
            draftTitle={agentDraftTitle}
            isExpanded={isAgentExpanded}
            launchRequest={agentLaunchRequest}
            onActivityChange={handleAgentActivityChange}
            onClose={() => setIsAgentOpen(false)}
            onExpand={() => setIsAgentOpen(true)}
            onToggleExpanded={() => setIsAgentExpanded((current) => !current)}
            variant={isAgentOpen ? "panel" : "mini"}
            initialInstruction=""
          />
        </div>
      ) : null}
      {!isAgentMounted ? (
        <Button
          className="fixed bottom-4 right-4 z-40 bg-accent text-accent-foreground shadow-lg"
          isIconOnly
          type="button"
          onPress={openAgent}
          aria-label="Open AI agent"
        >
          <span className="i-lucide-bot h-5 w-5" aria-hidden="true" />
        </Button>
      ) : null}
      {isSearchOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-backdrop px-4 pt-24">
          <section
            aria-modal="true"
            className="w-full max-w-lg rounded border border-border bg-overlay shadow-xl"
            role="dialog"
          >
            <div className="border-b border-border p-3">
              <input
                autoFocus
                className="w-full border-0 bg-transparent text-base text-foreground outline-none"
                placeholder="Search documents..."
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setIsSearchOpen(false);
                  }
                }}
                aria-label="Search documents"
              />
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {documents.isLoading ? (
                <p className="px-3 py-6 text-sm text-muted">Loading documents...</p>
              ) : null}
              {documents.isError ? (
                <p className="px-3 py-6 text-sm text-danger">Could not load documents.</p>
              ) : null}
              {!documents.isLoading && filteredDocuments.length === 0 ? (
                <p className="px-3 py-6 text-sm text-muted">No matching documents.</p>
              ) : null}
              {filteredDocuments.map((document) => (
                <button
                  key={document.id}
                  className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-surface-secondary"
                  type="button"
                  onClick={() => {
                    setIsSearchOpen(false);
                    setSearch("");
                    void navigate({
                      to: "/documents/$documentId",
                      params: { documentId: document.id },
                    });
                  }}
                >
                  <span className="block break-words font-medium text-foreground">
                    {document.title}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

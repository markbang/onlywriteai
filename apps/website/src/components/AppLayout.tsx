import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { getHealth } from "../api/documents.ts";

export function AppLayout() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => getHealth(),
  });

  const healthText = health.isSuccess
    ? "API online"
    : health.isError
      ? "API offline"
      : "Checking API";

  return (
    <div className="min-h-screen bg-stone-50 text-neutral-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="text-base font-semibold text-neutral-950">
            OnlyWrite
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/documents" className="text-neutral-600 hover:text-neutral-950">
              Documents
            </Link>
            <span className="rounded border border-stone-200 px-2 py-1 text-xs text-neutral-600">
              {healthText}
            </span>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

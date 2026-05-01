const installCommand = "vp dlx onlywrite";

const resourceCommands = [
  {
    icon: "i-lucide-file-plus",
    label: "Save a note",
    value: "onlywrite note create --title Idea --stdin --json",
  },
  {
    icon: "i-lucide-globe",
    label: "Import a reference",
    value: "onlywrite reference import https://example.com --json",
  },
  {
    icon: "i-lucide-search",
    label: "Search locally",
    value: 'onlywrite resource search "outline" --json',
  },
  { icon: "i-lucide-panel-right-open", label: "Open viewer", value: "onlywrite web --json" },
] as const;

const principles = [
  "Local SQLite store under ~/.onlywrite",
  "Resources are Notes or References",
  "CLI is the product API for humans and agents",
  "Web viewer is read-only and started locally",
] as const;

export function HomeRoute() {
  return (
    <div className="landing-shell overflow-hidden pt-16">
      <section className="relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-10 px-5 py-14 lg:grid-cols-[1.02fr_0.98fr] lg:py-16">
        <div className="relative z-10 max-w-2xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded border border-border bg-surface px-3 py-1 text-xs font-medium uppercase text-muted">
            <span className="i-lucide-hard-drive h-3.5 w-3.5" aria-hidden="true" />
            Local-only writing resources
          </p>
          <h1 className="landing-title text-balance text-5xl font-semibold leading-[0.96] text-foreground sm:text-6xl lg:text-7xl">
            OnlyWrite
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted">
            A personal writing resource system built around one command: store notes, import
            references, search your archive, and let external agents operate through the same CLI.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <code className="rounded border border-border bg-surface px-4 py-3 font-mono text-sm text-foreground shadow-sm">
              {installCommand}
            </code>
            <a
              className="inline-flex h-11 items-center gap-2 rounded bg-accent px-4 text-sm font-medium text-accent-foreground shadow-sm hover:opacity-92"
              href="#commands"
            >
              <span className="i-lucide-terminal h-4 w-4" aria-hidden="true" />
              View commands
            </a>
          </div>
        </div>

        <div className="relative z-10 rounded border border-border bg-surface p-3 shadow-xl">
          <div className="rounded border border-border bg-surface-secondary p-4">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <div>
                <p className="text-xs uppercase text-muted">~/.onlywrite</p>
                <h2 className="mt-1 text-xl font-semibold text-foreground">Resource viewer</h2>
              </div>
              <span className="rounded bg-success px-2 py-1 text-xs font-medium text-success-foreground">
                read-only
              </span>
            </div>
            <div className="grid gap-3">
              {resourceCommands.map((command) => (
                <div
                  className="grid grid-cols-[2rem_1fr] gap-3 rounded border border-border bg-surface p-3"
                  key={command.label}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded bg-surface-tertiary text-muted">
                    <span className={`${command.icon} h-4 w-4`} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{command.label}</p>
                    <code className="mt-1 block overflow-x-auto whitespace-nowrap font-mono text-xs text-muted">
                      {command.value}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="commands" className="border-y border-border bg-surface-secondary/70">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-14 md:grid-cols-4">
          {principles.map((principle) => (
            <div className="rounded border border-border bg-surface p-4" key={principle}>
              <span className="i-lucide-check h-4 w-4 text-success" aria-hidden="true" />
              <p className="mt-3 text-sm leading-6 text-foreground">{principle}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

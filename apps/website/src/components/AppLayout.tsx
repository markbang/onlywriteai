import { Button } from "@heroui/react";
import { Outlet } from "@tanstack/react-router";
import { type ThemeMode, useTheme } from "../theme.tsx";

const themeOptions: Array<{ icon: string; label: string; value: ThemeMode }> = [
  { icon: "i-lucide-monitor", label: "System", value: "system" },
  { icon: "i-lucide-sun", label: "Light", value: "light" },
  { icon: "i-lucide-moon", label: "Dark", value: "dark" },
];

export function AppLayout() {
  const { setThemeMode, themeMode } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fixed left-0 right-0 top-0 z-30 border-b border-border/70 bg-background/86 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a className="flex items-center gap-3 text-sm font-semibold text-foreground" href="/">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-accent text-accent-foreground shadow-sm">
              <span className="i-lucide-feather h-4 w-4" aria-hidden="true" />
            </span>
            OnlyWrite
          </a>
          <nav className="flex items-center gap-2" aria-label="Theme">
            {themeOptions.map((option) => (
              <Button
                key={option.value}
                aria-label={`${option.label} theme`}
                className={
                  themeMode === option.value
                    ? "border-accent bg-surface-secondary text-foreground"
                    : "border-border bg-transparent text-muted"
                }
                isIconOnly
                size="sm"
                type="button"
                variant="outline"
                onPress={() => setThemeMode(option.value)}
              >
                <span className={`${option.icon} h-4 w-4`} aria-hidden="true" />
              </Button>
            ))}
          </nav>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

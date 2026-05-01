import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { createQueryClient } from "./query.ts";
import { createAppRouter } from "./router.tsx";
import { ThemeProvider } from "./theme.tsx";

function renderRouter() {
  const router = createAppRouter();
  const queryClient = createQueryClient();

  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

test("renders the public OnlyWrite landing page without calling app APIs", async () => {
  window.history.pushState({}, "", "/");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  renderRouter();

  expect(await screen.findByRole("heading", { name: "OnlyWrite" })).toBeTruthy();
  expect(screen.getByText("Local-only writing resources")).toBeTruthy();
  expect(screen.getByText("vp dlx onlywrite")).toBeTruthy();
  expect(screen.getByText("onlywrite web --json")).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

test("switches landing page theme modes", async () => {
  window.history.pushState({}, "", "/");
  renderRouter();

  fireEvent.click(await screen.findByRole("button", { name: "Dark theme" }));

  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(window.localStorage.getItem("onlywrite.theme.mode")).toBe("dark");
});

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { createQueryClient } from "./query.ts";
import { createAppRouter } from "./router.tsx";

test("renders the OnlyWrite app shell", async () => {
  const router = createAppRouter();
  const queryClient = createQueryClient();

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("OnlyWrite")).toBeTruthy();
});

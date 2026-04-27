import "@unocss/reset/tailwind.css";
import "virtual:uno.css";
import "./style.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createQueryClient } from "./query.ts";
import { createAppRouter } from "./router.tsx";

const queryClient = createQueryClient();
const router = createAppRouter();

createRoot(document.querySelector<HTMLDivElement>("#app")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

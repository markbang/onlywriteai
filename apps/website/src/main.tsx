import "@unocss/reset/tailwind.css";
import "@heroui/react/styles";
import "@radix-ui/colors/slate.css";
import "@radix-ui/colors/slate-dark.css";
import "@radix-ui/colors/blue.css";
import "@radix-ui/colors/blue-dark.css";
import "@radix-ui/colors/green.css";
import "@radix-ui/colors/green-dark.css";
import "@radix-ui/colors/red.css";
import "@radix-ui/colors/red-dark.css";
import "@radix-ui/colors/amber.css";
import "@radix-ui/colors/amber-dark.css";
import "virtual:uno.css";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./style.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./auth.tsx";
import { createQueryClient } from "./query.ts";
import { createAppRouter } from "./router.tsx";
import { ThemeProvider } from "./theme.tsx";

const queryClient = createQueryClient();
const router = createAppRouter();

createRoot(document.querySelector<HTMLDivElement>("#app")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);

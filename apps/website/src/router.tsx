import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppLayout } from "./components/AppLayout.tsx";
import { DocumentRoute } from "./routes/DocumentRoute.tsx";
import { DocumentsRoute } from "./routes/DocumentsRoute.tsx";
import { HomeRoute } from "./routes/HomeRoute.tsx";
import { SettingsRoute } from "./routes/SettingsRoute.tsx";
import { SourcesRoute } from "./routes/SourcesRoute.tsx";

const rootRoute = createRootRoute({
  component: AppLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRoute,
});

const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents",
  component: DocumentsRoute,
});

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sources",
  component: SourcesRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsRoute,
});

const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$documentId",
  component: DocumentRoute,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  documentsRoute,
  sourcesRoute,
  settingsRoute,
  documentRoute,
]);

export function createAppRouter() {
  return createRouter({ routeTree });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

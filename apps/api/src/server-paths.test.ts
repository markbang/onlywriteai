import { expect, test } from "vite-plus/test";
import { isDevelopmentApiPath } from "./server-paths.ts";

test("treats Vite-proxied agent routes as development API paths", () => {
  expect(isDevelopmentApiPath("/agent/conversations/title")).toBe(true);
  expect(isDevelopmentApiPath("/agent/assist/stream")).toBe(true);
  expect(isDevelopmentApiPath("/documents/doc-1")).toBe(true);
  expect(isDevelopmentApiPath("/settings")).toBe(true);
  expect(isDevelopmentApiPath("/documents-view")).toBe(true);
  expect(isDevelopmentApiPath("/agentic")).toBe(false);
  expect(isDevelopmentApiPath("/documents/doc-1/edit")).toBe(true);
});

import { JSDOM } from "jsdom";
import { afterEach, vi } from "vite-plus/test";

if (typeof window === "undefined") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });

  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    self: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Node: { configurable: true, value: dom.window.Node },
    Event: { configurable: true, value: dom.window.Event },
    MouseEvent: { configurable: true, value: dom.window.MouseEvent },
    CustomEvent: { configurable: true, value: dom.window.CustomEvent },
    getComputedStyle: { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) },
    requestAnimationFrame: {
      configurable: true,
      value: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    },
    cancelAnimationFrame: { configurable: true, value: (handle: number) => clearTimeout(handle) },
  });
}

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

const { cleanup } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

import { JSDOM } from "jsdom";
import { afterEach, vi } from "vite-plus/test";

vi.mock("@milkdown/kit/utils", () => ({
  insert: (markdown: string) => (ctx: { insertMarkdown: (value: string) => void }) =>
    ctx.insertMarkdown(markdown),
  replaceAll: (markdown: string) => (ctx: { replaceMarkdown: (value: string) => void }) =>
    ctx.replaceMarkdown(markdown),
}));

vi.mock("@milkdown/crepe", () => {
  class MockCrepe {
    static Feature = {
      Placeholder: "placeholder",
    };

    editor = {
      action: (fn: (ctx: unknown) => void) =>
        fn({
          insertMarkdown: (value: string) => this.insertMarkdown(value),
          replaceMarkdown: (value: string) => this.setMarkdown(value),
        }),
    };

    private listeners: Array<(ctx: unknown, markdown: string, prevMarkdown: string) => void> = [];
    private markdown: string;
    private root: HTMLElement;

    constructor({ defaultValue = "", root }: { defaultValue?: string; root: HTMLElement }) {
      this.markdown = defaultValue;
      this.root = root;
    }

    on(
      fn: (listener: {
        markdownUpdated: (
          callback: (ctx: unknown, markdown: string, prevMarkdown: string) => void,
        ) => void;
      }) => void,
    ) {
      fn({
        markdownUpdated: (callback) => {
          this.listeners.push(callback);
        },
      });
      return this;
    }

    create() {
      this.root.textContent = this.markdown;
      this.root.setAttribute("contenteditable", "true");
      this.root.addEventListener("input", () => this.setMarkdown(this.root.textContent ?? ""));
      return Promise.resolve({});
    }

    destroy() {
      return Promise.resolve({});
    }

    getMarkdown() {
      return this.markdown;
    }

    private insertMarkdown(value: string) {
      this.setMarkdown(this.markdown ? `${this.markdown}\n\n${value}` : value);
    }

    private setMarkdown(value: string) {
      const previous = this.markdown;
      this.markdown = value;
      this.root.textContent = value;
      this.listeners.forEach((listener) => listener({}, value, previous));
    }
  }

  return { Crepe: MockCrepe };
});

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
    SVGElement: { configurable: true, value: dom.window.SVGElement },
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

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })),
});

const { cleanup } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

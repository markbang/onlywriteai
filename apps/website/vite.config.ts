import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react() as never, tailwindcss() as never, UnoCSS() as never],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    setupFiles: ["./src/test/setup.ts"],
  },
});

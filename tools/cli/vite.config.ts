import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});

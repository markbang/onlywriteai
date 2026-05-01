import { defineConfig, presetWind3 } from "unocss";
import presetIcons from "@unocss/preset-icons";

export default defineConfig({
  presets: [presetWind3(), presetIcons()],
});

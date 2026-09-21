import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2020",
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: they rarely change, so browsers keep
        // them cached across deploys of the app code.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts") || id.includes("d3-"))
            return "vendor-charts";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("socket.io") || id.includes("engine.io"))
            return "vendor-socket";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router") ||
            id.includes("/scheduler/")
          )
            return "vendor-react";
          // Everything else: let Rollup place it (avoids circular chunks).
          return undefined;
        },
      },
    },
  },
});

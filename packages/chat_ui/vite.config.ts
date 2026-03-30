import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig } from "vite"

const REGISTRY_API = process.env.VITE_REGISTRY_API || "http://localhost:8766"
const CHAT_BACKEND = process.env.VITE_CHAT_BACKEND || "http://localhost:8765"
const SYNTHESIS_API = process.env.VITE_SYNTHESIS_API || "http://localhost:8002"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/kiln": CHAT_BACKEND,
      "/tools": REGISTRY_API,
      "/health": REGISTRY_API,
      "/audio": REGISTRY_API,
      "/auth": REGISTRY_API,
      "/synthesis": SYNTHESIS_API,
    },
  },
})

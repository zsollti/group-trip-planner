import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import {
  AuthProvider,
  createQueryClient,
  setApiBaseUrl,
} from "@gtp/api-client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { initErrorReporting } from "./lib/monitoring";
import { applyTheme, getStoredTheme } from "./lib/theme";
import "./index.css";

// Before anything can throw. No-ops without VITE_SENTRY_DSN (Phase 7.5).
initErrorReporting();

// Apply the saved light/dark choice before first paint (no flash of OS theme).
applyTheme(getStoredTheme());

setApiBaseUrl(
  (import.meta.env.VITE_API_URL as string | undefined) ??
    "http://localhost:3000",
);

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

const queryClient = createQueryClient();

createRoot(root).render(
  <StrictMode>
    {/* Outermost, so a throw inside any provider is still caught. */}
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { applyInitialTheme } from "./components/ui/ThemeToggle";
import "./styles/theme.css";
import "./styles/global.css";

const moduleRecoveryKey = "__pixellock_module_recovery__";

applyInitialTheme();

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();

  const currentState =
    history.state && typeof history.state === "object"
      ? (history.state as Record<string, unknown>)
      : {};
  const lastRecovery = currentState[moduleRecoveryKey];

  if (
    typeof lastRecovery === "number" &&
    Date.now() - lastRecovery < 60_000
  ) {
    return;
  }

  history.replaceState(
    { ...currentState, [moduleRecoveryKey]: Date.now() },
    "",
  );
  window.location.reload();
});

const root = document.getElementById("root");

if (!root) {
  throw new Error("PixelLock could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ImageConverter from "../app/ImageConverter";
import "../app/globals.css";
import "./pages.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("PixelLock could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    <ImageConverter />
  </StrictMode>,
);

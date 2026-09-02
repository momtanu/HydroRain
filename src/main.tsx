import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { HydroRainApp } from "./HydroRainApp";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HydroRainApp />
  </StrictMode>,
);

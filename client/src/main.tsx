import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./styles.css";
import { ThemeProvider } from "./theme/index.ts";
import { BattleSvgDefinitions } from "./view/BattleSvgDefinitions.tsx";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing #root application element");
}

createRoot(rootElement).render(
  <ThemeProvider>
    <BattleSvgDefinitions />
    <App />
  </ThemeProvider>,
);

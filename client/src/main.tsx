import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./styles.css";
import { BattleSvgDefinitions } from "./view/BattleSvgDefinitions.tsx";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing #root application element");
}

createRoot(rootElement).render(
  <>
    <BattleSvgDefinitions />
    <App />
  </>,
);

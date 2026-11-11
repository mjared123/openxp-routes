import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Placeholder until the editor lands.
function App() {
  return (
    <main style={{ font: "16px/1.5 system-ui, sans-serif", maxWidth: 640, margin: "15vh auto", padding: "0 16px" }}>
      <h1>OpenXP Routes</h1>
      <p>A visual leveling route builder for World of Warcraft: Forever. The editor is on its way.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

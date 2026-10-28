import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
// Unregister the old push service worker
navigator.serviceWorker?.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

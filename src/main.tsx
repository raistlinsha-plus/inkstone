import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeLocale, useLocale } from "./i18n";
import { initializeAppearance } from "./platform/appearance";
import "./styles.css";
import "./polish.css";
import "./space.css";
import "./assistant/assistant.css";
import "./workbench-theme.css";
import "./assistant/workbench.css";
import "./assistant/contextual-composer.css";
import "./editor-workbench.css";
import "./knowledge/wiki.css";

initializeLocale();
initializeAppearance();

function LocalizedApp() {
  useLocale();
  return <App />;
}

if (
  import.meta.env.DEV &&
  new URLSearchParams(location.search).has("editor-test")
) {
  void import("./editor-harness").then(({ default: Harness }) =>
    ReactDOM.createRoot(document.getElementById("root")!).render(<Harness />),
  );
} else ReactDOM.createRoot(document.getElementById("root")!).render(<LocalizedApp />);

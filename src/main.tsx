import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./polish.css";
import "./space.css";

if (
  import.meta.env.DEV &&
  new URLSearchParams(location.search).has("editor-test")
) {
  void import("./editor-harness").then(({ default: Harness }) =>
    ReactDOM.createRoot(document.getElementById("root")!).render(<Harness />),
  );
} else ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

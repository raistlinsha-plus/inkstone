import { useEffect, useRef, useState } from "react";
import { invoke } from "../platform/ipc";
import { defaultView, type ViewPreferences } from "./selectors";
let writes: Promise<void> = Promise.resolve();
const eventName = "inkstone-library-view";
const latestWrites = new Map<string, number>();
function broadcast(
  projectId: string,
  preferences?: ViewPreferences,
  warning = "",
) {
  window.dispatchEvent(
    new CustomEvent(eventName, { detail: { projectId, preferences, warning } }),
  );
}
export function useViewPreferences(projectId: string) {
  const [preferences, setPreferences] = useState(defaultView),
    [warning, setWarning] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setPreferences(defaultView);
    setWarning("");
    const receive = (e: Event) => {
      const value = (
        e as CustomEvent<{
          projectId: string;
          preferences?: ViewPreferences;
          warning: string;
        }>
      ).detail;
      if (value.projectId !== projectId) return;
      ++generation.current;
      if (value.preferences) setPreferences(value.preferences);
      setWarning(value.warning);
    };
    window.addEventListener(eventName, receive);
    void writes
      .then(() => invoke("library_get_view", { projectId }))
      .then((p) => {
        if (request === generation.current && p) setPreferences(p);
      })
      .catch(() => {
        if (request === generation.current)
          setWarning("排序偏好暂不可读，已使用名称排序。");
      });
    return () => {
      ++generation.current;
      window.removeEventListener(eventName, receive);
    };
  }, [projectId]);
  function update(next: ViewPreferences) {
    ++generation.current;
    setPreferences(next);
    setWarning("");
    const project = projectId;
    const revision = (latestWrites.get(project) ?? 0) + 1;
    latestWrites.set(project, revision);
    broadcast(project, next);
    writes = writes
      .catch(() => {})
      .then(() =>
        invoke("library_set_view", { projectId: project, preferences: next }),
      )
      .then(() => {
        if (latestWrites.get(project) === revision) broadcast(project, next);
      })
      .catch(() => {
        if (latestWrites.get(project) !== revision) return;
        broadcast(project, undefined, "本次排序尚未保存，请重新选择以重试。");
      });
  }
  return { preferences, update, warning };
}

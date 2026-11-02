import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
export async function exportCalendar(
  content: string,
  name = "Inkstone-日程.ics",
) {
  if (isTauri()) {
    const path = await save({
      defaultPath: name,
      filters: [{ name: "iCalendar 日历", extensions: ["ics"] }],
    });
    if (path) await invoke("export_calendar_ics", { path, content });
  } else {
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/calendar;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

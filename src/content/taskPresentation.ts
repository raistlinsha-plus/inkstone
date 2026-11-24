import { translate } from "../i18n";
import { dateTimeInput } from "./calendar";
import type { TaskMeta } from "./tasks";

/** Planning details are a view of the Markdown annotation, never editable text in the title. */
export function taskDetails(meta: TaskMeta, checked: boolean) {
  const details = [
    checked ? translate("已完成", "Completed") : translate("待办", "To do"),
  ];
  if (meta.due) details.push(translate("截止", "Due") + " " + meta.due);
  if (meta.waiting) details.push(translate("等回复", "Waiting for a reply"));
  if (meta.followOn)
    details.push(translate("跟进", "Follow up") + " " + meta.followOn);
  if (meta.slot) {
    const { start, end, zone } = meta.slot;
    const from = dateTimeInput(start, zone);
    const to = dateTimeInput(end, zone);
    const until =
      from.slice(0, 10) === to.slice(0, 10)
        ? to.slice(11)
        : to.replace("T", " ");
    details.push(
      translate("排期", "Scheduled") +
        " " +
        from.replace("T", " ") +
        " – " +
        until +
        " · " +
        zone,
    );
  }
  return details;
}

export function taskToggleLabel(title: string, checked: boolean) {
  return (
    (checked
      ? translate("恢复为待办", "Mark incomplete")
      : translate("标记完成", "Mark complete")) +
    " · " +
    title
  );
}

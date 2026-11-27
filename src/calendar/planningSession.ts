import type {
  CalendarContentBlock,
  CalendarDocument,
  CalendarEvent,
  DateRange,
} from "../content/calendar";
import type { ProjectTask } from "../tasks/project";
import type { WorkspaceCalendarView } from "./projectCalendarView";

export interface EventFormValues {
  title: string;
  zone: string;
  allDay: boolean;
  start: string;
  end: string;
  startInstant: string | null;
  endInstant: string | null;
  status: CalendarEvent["status"];
  notes: string;
}

interface PlanningForm<T extends object> {
  initial?: T;
  values?: T;
  changed?: boolean;
}

export function rememberPlanningForm<T extends object>(
  form: PlanningForm<T> | undefined,
  values: T,
) {
  if (!form) return;
  const initial = (form.initial ??= values);
  form.values = values;
  form.changed = (Object.keys(values) as (keyof T)[]).some(
    (key) => values[key] !== initial[key],
  );
}

export interface EventEditing {
  source?: { document: CalendarDocument; block: CalendarContentBlock };
  time?: string;
  allDay?: boolean;
  event?: CalendarEvent;
  date?: string;
  form: PlanningForm<EventFormValues>;
}

export interface TaskEditing {
  origin: ProjectTask;
  form: PlanningForm<{
    title: string;
    due: string;
    done: boolean;
    waiting: boolean;
    followOn: string;
    zone: string;
    start: string;
    end: string;
  }>;
}

// The owning App keeps one session per managed space until the window closes.
export interface PlanningSession {
  taskDetail?: TaskEditing | null;
  task?: {
    title: string;
    target: string;
    retry?: { signature: string; id: string };
  };
  calendar?: {
    anchor: string;
    range: DateRange;
    view: WorkspaceCalendarView;
    query: string;
    showEvents: boolean;
    showTasks: boolean;
    status: string;
    target: string;
    editing: EventEditing | null;
    taskEditor: TaskEditing | null;
  };
}

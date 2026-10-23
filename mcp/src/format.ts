/** Markdown rendering shared by the tools. Ids stay visible so follow-up calls can use them. */
import type { CompletionItem, Label, Project, Section, Task } from "./api.js";
import type { Workspace } from "./lookup.js";
import { todayStr } from "./lookup.js";

export const CHARACTER_LIMIT = 25_000;

const RECURRENCE_LABEL: Record<Task["recurrence"], string> = {
  none: "",
  daily: "every day",
  weekdays: "every weekday",
  weekly: "every week",
  biweekly: "every 2 weeks",
  monthly: "every month",
  yearly: "every year"
};

export function dueDescription(task: Pick<Task, "dueDate" | "dueTime">): string {
  if (!task.dueDate) return "";
  const today = todayStr();
  let word: string;
  if (task.dueDate < today) word = `overdue (${task.dueDate})`;
  else if (task.dueDate === today) word = "today";
  else if (task.dueDate === todayStr(1)) word = "tomorrow";
  else word = task.dueDate;
  return task.dueTime ? `${word} ${task.dueTime}` : word;
}

export function formatTask(task: Task, ws: Workspace, options: { indent?: number } = {}): string {
  const project = ws.projects.find((p) => p.id === task.projectId);
  const section = task.sectionId ? ws.sections.find((s) => s.id === task.sectionId) : undefined;
  const labels = task.labelIds
    .map((id) => ws.labels.find((l) => l.id === id)?.name)
    .filter((n): n is string => Boolean(n))
    .map((n) => `@${n}`);
  const bits: string[] = [];
  const due = dueDescription(task);
  if (due) bits.push(`due ${due}`);
  if (task.recurrence !== "none") bits.push(`repeats ${RECURRENCE_LABEL[task.recurrence]}`);
  if (task.priority < 4) bits.push(`P${task.priority}`);
  if (project && !project.isInbox) bits.push(`#${project.name}${section ? ` / ${section.name}` : ""}`);
  else if (section) bits.push(`/ ${section.name}`);
  if (labels.length) bits.push(labels.join(" "));
  if (task.isCompleted && task.completedAt) bits.push(`done ${task.completedAt.slice(0, 10)}`);
  const pad = " ".repeat(options.indent ?? 0);
  const box = task.isCompleted ? "[x]" : "[ ]";
  const line = `${pad}- ${box} ${task.content} (id: ${task.id})${bits.length ? ` · ${bits.join(" · ")}` : ""}`;
  return task.description ? `${line}\n${pad}  ${task.description.replace(/\n/g, `\n${pad}  `)}` : line;
}

/** Parents first, their sub-tasks indented beneath them. */
export function formatTaskList(tasks: Task[], ws: Workspace): string {
  const byParent = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId && tasks.some((p) => p.id === t.parentId)) {
      byParent.set(t.parentId, [...(byParent.get(t.parentId) ?? []), t]);
    }
  }
  const lines: string[] = [];
  for (const t of tasks) {
    if (t.parentId && tasks.some((p) => p.id === t.parentId)) continue;
    lines.push(formatTask(t, ws));
    for (const child of byParent.get(t.id) ?? []) lines.push(formatTask(child, ws, { indent: 2 }));
  }
  return lines.join("\n");
}

export function formatProject(project: Project, sections: Section[], counts: Map<string, number>): string {
  const n = counts.get(project.id) ?? 0;
  const head = `- ${project.isInbox ? "Inbox" : project.name} (id: ${project.id})${project.isFavorite ? " ★" : ""} · ${n} open task${n === 1 ? "" : "s"} · color ${project.color}`;
  const subs = sections.filter((s) => s.projectId === project.id).map((s) => `  - section ${s.name} (id: ${s.id})`);
  return [head, ...subs].join("\n");
}

export function formatLabel(label: Label, count: number): string {
  return `- @${label.name} (id: ${label.id}) · ${count} open task${count === 1 ? "" : "s"} · color ${label.color}`;
}

export function formatCompletion(item: CompletionItem, ws: Workspace): string {
  const project = ws.projects.find((p) => p.id === item.projectId);
  return `- ${item.completedAt.slice(0, 16).replace("T", " ")} · ${item.content}${project && !project.isInbox ? ` · #${project.name}` : ""}`;
}

/** Keep a page under CHARACTER_LIMIT by returning fewer items, never by cutting text. */
export function fitPage<T>(items: T[], render: (slice: T[]) => string): { items: T[]; text: string } {
  let slice = items;
  let text = render(slice);
  while (slice.length > 1 && text.length > CHARACTER_LIMIT) {
    slice = slice.slice(0, Math.ceil(slice.length / 2));
    text = render(slice);
  }
  return { items: slice, text };
}

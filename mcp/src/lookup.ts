/**
 * Name-or-id resolution and shared workspace reads. Assistants usually know a project as "Rehab",
 * not as a 24-character id, so every tool accepts either.
 */
import { api, type Label, type Project, type Section } from "./api.js";

export const ID_PATTERN = /^[0-9a-f]{24}$/i;

export interface Workspace {
  projects: Project[];
  sections: Section[];
  labels: Label[];
}

export async function loadWorkspace(signal?: AbortSignal): Promise<Workspace> {
  const [projects, sections, labels] = await Promise.all([
    api<Project[]>("GET", "/api/projects", undefined, signal),
    api<Section[]>("GET", "/api/sections", undefined, signal),
    api<Label[]>("GET", "/api/labels", undefined, signal)
  ]);
  return { projects, sections, labels };
}

const byName = <T extends { id: string; name: string }>(items: T[], ref: string): T | undefined =>
  items.find((i) => i.id === ref) ??
  items.find((i) => i.name.toLowerCase() === ref.trim().toLowerCase()) ??
  items.find((i) => i.name.toLowerCase().startsWith(ref.trim().toLowerCase()));

export function resolveProject(ws: Workspace, ref: string | undefined): Project {
  if (!ref || ref.trim().toLowerCase() === "inbox") {
    const inbox = ws.projects.find((p) => p.isInbox);
    if (!inbox) throw new Error("No Inbox project exists; create a project first.");
    return inbox;
  }
  const project = byName(ws.projects, ref);
  if (!project) {
    const names = ws.projects.map((p) => p.name).join(", ");
    throw new Error(`No project matches "${ref}". Existing projects: ${names}.`);
  }
  return project;
}

export function resolveSection(ws: Workspace, project: Project, ref: string | undefined): Section | null {
  if (!ref) return null;
  const inProject = ws.sections.filter((s) => s.projectId === project.id);
  const section = byName(inProject, ref);
  if (!section) {
    const names = inProject.map((s) => s.name).join(", ") || "(none)";
    throw new Error(`No section "${ref}" in project "${project.name}". Sections there: ${names}.`);
  }
  return section;
}

export function resolveLabel(ws: Workspace, ref: string): Label | undefined {
  return byName(ws.labels, ref.replace(/^@/, ""));
}

/** Labels by name or id; unknown names are created (the API makes label creation idempotent by name). */
export async function resolveOrCreateLabels(ws: Workspace, refs: string[] | undefined, signal?: AbortSignal): Promise<string[]> {
  if (!refs || refs.length === 0) return [];
  const ids: string[] = [];
  for (const ref of refs) {
    const existing = resolveLabel(ws, ref);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const name = ref.replace(/^@/, "").trim();
    if (!name) continue;
    const created = await api<Label>("POST", "/api/labels", { name }, signal);
    ws.labels.push(created);
    ids.push(created.id);
  }
  return [...new Set(ids)];
}

export function todayStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Accepts yyyy-MM-dd plus the words today / tomorrow; returns yyyy-MM-dd. */
export function normalizeDate(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "" || value.trim().toLowerCase() === "none") return null;
  const v = value.trim().toLowerCase();
  if (v === "today") return todayStr();
  if (v === "tomorrow") return todayStr(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  throw new Error(`Due date "${value}" must be yyyy-MM-dd, "today" or "tomorrow".`);
}

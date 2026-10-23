/**
 * Client for the MyTodoEase API (ASP.NET Core, localhost only). If nothing answers on the port,
 * the bundled API executable is started so the assistant can work while the desktop app is closed.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const API_URL = (process.env.MYTODOEASE_API_URL ?? "http://localhost:5080").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: Record<string, string[]> = {}
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function httpErrorMessage(status: number, detail: string | undefined): string {
  switch (status) {
    case 404:
      return "Not found. Check the id; list tools return valid ids.";
    case 400:
      return detail ? `The API rejected the request: ${detail}` : "The API rejected the request.";
    default:
      return detail ? `MyTodoEase API returned HTTP ${status}: ${detail}` : `MyTodoEase API returned HTTP ${status}.`;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let detail: string | undefined;
  let errors: Record<string, string[]> = {};
  try {
    const body = (await response.json()) as { errors?: Record<string, string[]>; detail?: string; title?: string };
    if (body?.errors && typeof body.errors === "object") {
      errors = body.errors;
      detail = Object.entries(errors)
        .map(([field, messages]) => `${field}: ${messages.join(" ")}`)
        .join("; ");
    } else {
      detail = body?.detail ?? body?.title;
    }
  } catch {
    // Non-JSON body: keep the status text.
  }
  return new ApiError(response.status, httpErrorMessage(response.status, detail), errors);
}

async function rawRequest<T>(method: string, apiPath: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
  if (signal) signals.push(signal);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${apiPath}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any(signals)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`The MyTodoEase API at ${API_URL} did not respond within 30 seconds.`);
    }
    throw error;
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function healthy(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Where the published API executable usually lives: an explicit override, the installed app, or this repo. */
function apiExecutableCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MYTODOEASE_API_EXE,
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "MyTodoEase", "resources", "api", "MyTodoEase.Api.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "MyTodoEase", "resources", "api", "MyTodoEase.Api.exe"),
    path.join(here, "..", "..", "desktop", "build", "api", "MyTodoEase.Api.exe")
  ];
  return candidates.filter((c): c is string => Boolean(c));
}

let starting: Promise<void> | undefined;

/**
 * Make sure an API answers on API_URL. When the desktop app is closed nothing is listening, so the
 * bundled executable is started detached: it stays up for the desktop app to reuse and shuts down
 * with the app, exactly as if the app had started it.
 */
export async function ensureApi(): Promise<void> {
  if (await healthy()) return;
  if (!starting) {
    starting = (async () => {
      const exe = apiExecutableCandidates().find((c) => existsSync(c));
      if (!exe) {
        throw new Error(
          `Nothing is listening at ${API_URL} and no API executable was found. Open the MyTodoEase desktop app, ` +
            "or set MYTODOEASE_API_EXE to the path of MyTodoEase.Api.exe."
        );
      }
      console.error(`[mytodoease-mcp] starting API: ${exe}`);
      const child = spawn(exe, [], {
        cwd: path.dirname(exe),
        env: { ...process.env, ASPNETCORE_URLS: API_URL, ASPNETCORE_ENVIRONMENT: "Production" },
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.unref();
      for (let attempt = 0; attempt < 80; attempt++) {
        if (await healthy()) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`Started ${exe} but ${API_URL} did not become healthy within 20 seconds.`);
    })().finally(() => {
      starting = undefined;
    });
  }
  await starting;
}

export async function api<T>(method: string, apiPath: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  await ensureApi();
  return rawRequest<T>(method, apiPath, body, signal);
}

// ---- Data types, mirroring the API's JSON (camelCase) ----

export type Recurrence = "none" | "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly";
export type Priority = 1 | 2 | 3 | 4;

export interface Project {
  id: string;
  name: string;
  color: string;
  order: number;
  isInbox: boolean;
  isFavorite: boolean;
  createdAt: string;
}

export interface Section {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: string;
}

export interface Task {
  id: string;
  content: string;
  description: string;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  labelIds: string[];
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  durationMinutes: number | null;
  recurrence: Recurrence;
  isCompleted: boolean;
  completedAt: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  content: string;
  description?: string;
  projectId: string;
  sectionId?: string | null;
  parentId?: string | null;
  labelIds?: string[];
  priority?: Priority;
  dueDate?: string | null;
  dueTime?: string | null;
  durationMinutes?: number | null;
  recurrence?: Recurrence;
  order?: number;
}

export interface CompletionItem {
  taskId: string;
  content: string;
  projectId: string;
  completedAt: string;
}

export interface CompletionsResponse {
  years: number[];
  items: CompletionItem[];
}

export const taskToInput = (task: Task): TaskInput => ({
  content: task.content,
  description: task.description,
  projectId: task.projectId,
  sectionId: task.sectionId,
  parentId: task.parentId,
  labelIds: task.labelIds,
  priority: task.priority,
  dueDate: task.dueDate,
  dueTime: task.dueTime,
  durationMinutes: task.durationMinutes,
  recurrence: task.recurrence,
  order: task.order
});

import type {
  CompletionsResponse,
  Label,
  LabelInput,
  Project,
  ProjectInput,
  ReorderItem,
  Section,
  SectionInput,
  Task,
  TaskInput,
} from './types';

export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:5080';

export class ApiError extends Error {
  status: number;
  /** Field -> messages, when the server returned a validation problem. */
  errors: Record<string, string[]>;

  constructor(status: number, message: string, errors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API_BASE_URL + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${API_BASE_URL}. Is the backend running?`);
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let errors: Record<string, string[]> = {};
    try {
      const body = await response.json();
      if (body?.errors && typeof body.errors === 'object') {
        errors = body.errors;
        message = Object.values(errors).flat().join(' ') || message;
      } else if (typeof body?.detail === 'string') {
        message = body.detail;
      } else if (typeof body?.title === 'string') {
        message = body.title;
      }
    } catch {
      // Non-JSON error body: keep the status text.
    }
    throw new ApiError(response.status, message, errors);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const api = {
  health: () => request<{ status: string }>('/api/health'),

  projects: {
    list: () => request<Project[]>('/api/projects'),
    create: (input: ProjectInput) => request<Project>('/api/projects', { method: 'POST', ...json(input) }),
    update: (id: string, input: ProjectInput) =>
      request<Project>(`/api/projects/${id}`, { method: 'PUT', ...json(input) }),
    remove: (id: string) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  },

  sections: {
    list: () => request<Section[]>('/api/sections'),
    create: (input: SectionInput) => request<Section>('/api/sections', { method: 'POST', ...json(input) }),
    update: (id: string, input: SectionInput) =>
      request<Section>(`/api/sections/${id}`, { method: 'PUT', ...json(input) }),
    remove: (id: string) => request<void>(`/api/sections/${id}`, { method: 'DELETE' }),
  },

  labels: {
    list: () => request<Label[]>('/api/labels'),
    create: (input: LabelInput) => request<Label>('/api/labels', { method: 'POST', ...json(input) }),
    update: (id: string, input: LabelInput) => request<Label>(`/api/labels/${id}`, { method: 'PUT', ...json(input) }),
    remove: (id: string) => request<void>(`/api/labels/${id}`, { method: 'DELETE' }),
  },

  tasks: {
    listActive: () => request<Task[]>('/api/tasks'),
    listCompleted: (limit = 500) => request<Task[]>(`/api/tasks?completed=true&limit=${limit}`),
    create: (input: TaskInput) => request<Task>('/api/tasks', { method: 'POST', ...json(input) }),
    update: (id: string, input: TaskInput) => request<Task>(`/api/tasks/${id}`, { method: 'PUT', ...json(input) }),
    remove: (id: string) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
    complete: (id: string) => request<Task>(`/api/tasks/${id}/complete`, { method: 'POST' }),
    reopen: (id: string) => request<Task>(`/api/tasks/${id}/reopen`, { method: 'POST' }),
    reorder: (items: ReorderItem[]) => request<void>('/api/tasks/reorder', { method: 'POST', ...json({ items }) }),
  },

  stats: {
    /** Completion history between two local calendar dates (yyyy-MM-dd, inclusive). */
    completions: (from: string, to: string) =>
      request<CompletionsResponse>(`/api/stats/completions?from=${from}&to=${to}`),
  },
};

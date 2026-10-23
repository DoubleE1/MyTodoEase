export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

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
  /** yyyy-MM-dd in the user's local calendar, or null. */
  dueDate: string | null;
  /** HH:mm, only meaningful when dueDate is set. */
  dueTime: string | null;
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
  recurrence?: Recurrence;
  order?: number;
}

export interface ProjectInput {
  name: string;
  color?: string;
  order?: number;
  isFavorite?: boolean;
}

export interface SectionInput {
  projectId: string;
  name: string;
  order?: number;
}

export interface LabelInput {
  name: string;
  color?: string;
  order?: number;
}

/** One completion event from the history log (survives recurrence roll-forward and task deletion). */
export interface CompletionItem {
  taskId: string;
  content: string;
  projectId: string;
  completedAt: string;
}

export interface CompletionsResponse {
  /** Calendar years that have any history, oldest first. */
  years: number[];
  items: CompletionItem[];
}

export interface ReorderItem {
  id: string;
  order: number;
  /** null = unchanged, '' = clear, otherwise set. */
  sectionId?: string | null;
  parentId?: string | null;
}

/** Whole-database backup as produced by GET /api/backup. */
export interface BackupDocument {
  app: string;
  version: number;
  exportedAt: string;
  projects: Project[];
  sections: Section[];
  labels: Label[];
  tasks: Task[];
  completions: unknown[];
}

export interface GoogleAccount {
  email: string;
  name: string;
  picture: string | null;
  scopes: string[];
  connectedAt: string;
}

export interface GoogleAuthStatus {
  configured: boolean;
  clientId: string | null;
  signedIn: boolean;
  account: GoogleAccount | null;
  /** A sign-in was started and Google has not called back yet. */
  pending: boolean;
}

export interface CalendarSyncStatus {
  scopeGranted: boolean;
  enabled: boolean;
  targetCalendarId: string | null;
  sourceCalendarIds: string[];
  lastSyncAt: string | null;
  lastError: string | null;
  linkedTasks: number;
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  backgroundColor: string | null;
  primary: boolean;
  accessRole: string | null;
}

/** An event from one of the user's Google calendars, in local calendar dates. */
export interface ExternalEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  color: string | null;
  title: string;
  location: string | null;
  date: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  htmlLink: string | null;
}

export interface ImportResult {
  projects: number;
  sections: number;
  labels: number;
  tasks: number;
  completions: number;
}

export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

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

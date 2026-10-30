/**
 * Firestore implementation of the data API for the hosted web app. Mirrors the rules the desktop
 * ASP.NET API applies (validation, cascades, recurrence roll-forward, backup import) so both apps
 * behave the same and backups move between them unchanged.
 *
 * Layout: users/{uid}/{projects|sections|labels|tasks|completions}/{id}. Documents are stored with
 * the exact camelCase JSON shape the API returns.
 */
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
  type CollectionReference,
  type DocumentReference,
  type WriteBatch,
} from 'firebase/firestore';
import { firebase, googleProvider } from '../firebase/app';
import { connectCalendar, disconnectCloudCalendar, getCalendarAccessToken } from './calendarAccess';
import { calendarStatusFrom, runCalendarSync } from './calendarSync';
import { parseDateStr, toDateStr } from '../lib/dates';
import { stepDate } from '../lib/recurrence';
import type { Api } from './client';
import { ApiError } from './errors';
import { isValidId, newId } from './ids';
import type {
  BackupDocument,
  ExternalEvent,
  GoogleAuthStatus,
  GoogleCalendarInfo,
  Label,
  LabelInput,
  Project,
  ProjectInput,
  ReorderItem,
  Section,
  SectionInput,
  Task,
  TaskInput,
  Note,
  NoteInput,
} from './types';

type CollectionName = 'projects' | 'sections' | 'labels' | 'tasks' | 'completions' | 'notes' | 'calendarEvents';

/** One completion log entry, as stored and as exported in backups. */
interface Completion {
  id: string;
  taskId: string;
  content: string;
  projectId: string;
  completedAt: string;
}

const BATCH_LIMIT = 400; // Firestore allows 500 writes per batch; leave headroom.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const nowIso = () => new Date().toISOString();

function currentUser(): User {
  const user = firebase().auth.currentUser;
  if (!user) throw new ApiError(401, 'Sign in to continue.');
  return user;
}

/** users/{uid}: the signed-in user's document, root of everything the app stores. */
export function userDoc(): DocumentReference {
  return doc(firebase().db, 'users', currentUser().uid);
}

export function userCollection(name: CollectionName): CollectionReference {
  return collection(userDoc(), name);
}

const ref = (name: CollectionName, id: string): DocumentReference => doc(userCollection(name), id);

async function all<T>(name: CollectionName): Promise<T[]> {
  const snap = await getDocs(userCollection(name));
  return snap.docs.map((d) => d.data() as T);
}

async function one<T>(name: CollectionName, id: string): Promise<T | null> {
  if (!isValidId(id)) return null;
  const snap = await getDoc(ref(name, id));
  return snap.exists() ? (snap.data() as T) : null;
}

async function tasksWhere(field: 'projectId' | 'sectionId' | 'parentId', value: string): Promise<Task[]> {
  const snap = await getDocs(query(userCollection('tasks'), where(field, '==', value)));
  return snap.docs.map((d) => d.data() as Task);
}

function notFound(): never {
  throw new ApiError(404, 'Not found.');
}

function invalid(errors: Record<string, string[]>): never {
  throw new ApiError(400, Object.values(errors).flat().join(' '), errors);
}

/** Run a set of writes in batches of at most BATCH_LIMIT operations. */
async function batched(count: number, fill: (batch: WriteBatch, index: number) => void): Promise<void> {
  for (let start = 0; start < count; start += BATCH_LIMIT) {
    const batch = writeBatch(firebase().db);
    for (let i = start; i < Math.min(count, start + BATCH_LIMIT); i++) fill(batch, i);
    await batch.commit();
  }
}

const byOrderThenCreated = <T extends { order: number; createdAt: string }>(a: T, b: T) =>
  a.order - b.order || a.createdAt.localeCompare(b.createdAt);

export const sortProjects = (items: Project[]) => [...items].sort(byOrderThenCreated);
export const sortSections = (items: Section[]) => [...items].sort(byOrderThenCreated);
export const sortLabels = (items: Label[]) => [...items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
export const sortActiveTasks = (items: Task[]) => items.filter((t) => !t.isCompleted).sort(byOrderThenCreated);
export const sortCompletedTasks = (items: Task[], max = 500) =>
  items
    .filter((t) => t.isCompleted)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, max);

// ---- Projects ----

async function ensureInbox(projects: Project[]): Promise<Project[]> {
  if (projects.some((p) => p.isInbox)) return projects;
  const inbox: Project = { id: newId(), name: 'Inbox', color: 'grey', order: -1, isInbox: true, isFavorite: false, createdAt: nowIso() };
  await setDoc(ref('projects', inbox.id), inbox);
  return [inbox, ...projects];
}

const projects: Api['projects'] = {
  list: async () => sortProjects(await ensureInbox(await all<Project>('projects'))),

  create: async (input: ProjectInput) => {
    if (!input.name?.trim()) invalid({ name: ['Name is required.'] });
    const existing = await all<Project>('projects');
    const last = Math.max(-1, ...existing.map((p) => p.order));
    const project: Project = {
      id: newId(),
      name: input.name.trim(),
      color: input.color ?? 'grey',
      order: input.order ?? last + 1,
      isInbox: false,
      isFavorite: input.isFavorite ?? false,
      createdAt: nowIso(),
    };
    await setDoc(ref('projects', project.id), project);
    return project;
  },

  update: async (id: string, input: ProjectInput) => {
    if (!input.name?.trim()) invalid({ name: ['Name is required.'] });
    const project = (await one<Project>('projects', id)) ?? notFound();
    const next: Project = {
      ...project,
      name: input.name.trim(),
      color: input.color ?? 'grey',
      isFavorite: input.isFavorite ?? false,
      order: input.order ?? project.order,
    };
    await setDoc(ref('projects', id), next);
    return next;
  },

  remove: async (id: string) => {
    const project = (await one<Project>('projects', id)) ?? notFound();
    if (project.isInbox) throw new ApiError(400, 'The Inbox project cannot be deleted.');
    // Cascade: a project owns its sections and tasks.
    const [tasks, sectionsSnap] = await Promise.all([
      tasksWhere('projectId', id),
      getDocs(query(userCollection('sections'), where('projectId', '==', id))),
    ]);
    const refs = [...tasks.map((t) => ref('tasks', t.id)), ...sectionsSnap.docs.map((d) => d.ref), ref('projects', id)];
    await batched(refs.length, (batch, i) => batch.delete(refs[i]));
  },
};

// ---- Sections ----

async function validateSection(input: SectionInput) {
  const errors: Record<string, string[]> = {};
  if (!input.name?.trim()) errors.name = ['Name is required.'];
  if (!(await one<Project>('projects', input.projectId))) errors.projectId = ['Project does not exist.'];
  if (Object.keys(errors).length) invalid(errors);
}

const sections: Api['sections'] = {
  list: async () => sortSections(await all<Section>('sections')),

  create: async (input: SectionInput) => {
    await validateSection(input);
    const snap = await getDocs(query(userCollection('sections'), where('projectId', '==', input.projectId)));
    const last = Math.max(-1, ...snap.docs.map((d) => (d.data() as Section).order));
    const section: Section = {
      id: newId(),
      projectId: input.projectId,
      name: input.name.trim(),
      order: input.order ?? last + 1,
      createdAt: nowIso(),
    };
    await setDoc(ref('sections', section.id), section);
    return section;
  },

  update: async (id: string, input: SectionInput) => {
    await validateSection(input);
    const section = (await one<Section>('sections', id)) ?? notFound();
    const next: Section = { ...section, name: input.name.trim(), projectId: input.projectId, order: input.order ?? section.order };
    await setDoc(ref('sections', id), next);
    return next;
  },

  remove: async (id: string) => {
    if (!(await one<Section>('sections', id))) notFound();
    // Tasks in the section are kept and moved to the project root rather than destroyed.
    const tasks = await tasksWhere('sectionId', id);
    await batched(tasks.length + 1, (batch, i) => {
      if (i === tasks.length) batch.delete(ref('sections', id));
      else batch.set(ref('tasks', tasks[i].id), { ...tasks[i], sectionId: null });
    });
  },
};

// ---- Labels ----

// ---- Notes (sticky notes board) ----

export const sortNotes = (items: Note[]) =>
  [...items].sort((a, b) => a.order - b.order || b.createdAt.localeCompare(a.createdAt));

const NOTE_COLOR_SET = new Set(['yellow', 'green', 'blue', 'pink', 'purple', 'orange', 'grey']);

function validateNote(input: NoteInput) {
  const errors: Record<string, string[]> = {};
  if (input.text !== undefined && input.text.length > 20000) errors.text = ['A note can hold at most 20000 characters.'];
  if (input.color !== undefined && !NOTE_COLOR_SET.has(input.color)) errors.color = ['Unknown note colour.'];
  if (input.taskIds !== undefined && (input.taskIds.length > 100 || !input.taskIds.every(isValidId)))
    errors.taskIds = ['Task ids must be valid, at most 100.'];
  for (const v of [input.x, input.y])
    if (v !== undefined && !(Number.isFinite(v) && v >= 0 && v <= 100000)) errors.position = ['Position must be between 0 and 100000.'];
  if (input.w !== undefined && !(Number.isFinite(input.w) && input.w >= 220 && input.w <= 1200)) errors.w = ['Width must be between 220 and 1200.'];
  if (input.h !== undefined && !(Number.isFinite(input.h) && input.h >= 160 && input.h <= 1600)) errors.h = ['Height must be between 160 and 1600.'];
  if (Object.keys(errors).length) invalid(errors);
}

const notes: Api['notes'] = {
  list: async () => sortNotes(await all<Note>('notes')),

  create: async (input: NoteInput) => {
    validateNote(input);
    const existing = await all<Note>('notes');
    const now = nowIso();
    const note: Note = {
      id: newId(),
      text: input.text ?? '',
      color: input.color ?? 'yellow',
      order: input.order ?? (existing.length === 0 ? 0 : Math.min(...existing.map((n) => n.order)) - 1),
      isArchived: input.isArchived ?? false,
      taskIds: [...new Set(input.taskIds ?? [])],
      x: input.x ?? null,
      y: input.y ?? null,
      w: input.w ?? null,
      h: input.h ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(ref('notes', note.id), note);
    return note;
  },

  update: async (id: string, input: NoteInput) => {
    validateNote(input);
    const note = (await one<Note>('notes', id)) ?? notFound();
    const next: Note = {
      ...note,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
      ...(input.taskIds !== undefined ? { taskIds: [...new Set(input.taskIds)] } : {}),
      ...(input.x !== undefined ? { x: input.x } : {}),
      ...(input.y !== undefined ? { y: input.y } : {}),
      ...(input.w !== undefined ? { w: input.w } : {}),
      ...(input.h !== undefined ? { h: input.h } : {}),
      // Moving a note is not an edit of its content.
      updatedAt: input.text !== undefined || input.color !== undefined ? nowIso() : note.updatedAt,
    };
    await setDoc(ref('notes', id), next);
    return next;
  },

  remove: async (id: string) => {
    if (!(await one<Note>('notes', id))) notFound();
    await deleteDoc(ref('notes', id));
  },

  reorder: async (items: { id: string; order: number }[]) => {
    const found = (await Promise.all(items.map((i) => one<Note>('notes', i.id)))).map((note, i) => ({ note, order: items[i].order }));
    const updates = found.filter((f): f is { note: Note; order: number } => f.note !== null).map((f) => ({ ...f.note, order: f.order }));
    await batched(updates.length, (batch, i) => batch.set(ref('notes', updates[i].id), updates[i]));
  },
};

const labels: Api['labels'] = {
  list: async () => sortLabels(await all<Label>('labels')),

  create: async (input: LabelInput) => {
    if (!input.name?.trim()) invalid({ name: ['Name is required.'] });
    const name = input.name.trim();
    const existing = await all<Label>('labels');
    const match = existing.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (match) return match; // idempotent: labels are unique by name
    const last = Math.max(-1, ...existing.map((l) => l.order));
    const label: Label = { id: newId(), name, color: input.color ?? 'grey', order: input.order ?? last + 1, createdAt: nowIso() };
    await setDoc(ref('labels', label.id), label);
    return label;
  },

  update: async (id: string, input: LabelInput) => {
    if (!input.name?.trim()) invalid({ name: ['Name is required.'] });
    const label = (await one<Label>('labels', id)) ?? notFound();
    const next: Label = { ...label, name: input.name.trim(), color: input.color ?? 'grey', order: input.order ?? label.order };
    await setDoc(ref('labels', id), next);
    return next;
  },

  remove: async (id: string) => {
    if (!(await one<Label>('labels', id))) notFound();
    const snap = await getDocs(query(userCollection('tasks'), where('labelIds', 'array-contains', id)));
    const tasks = snap.docs.map((d) => d.data() as Task);
    await batched(tasks.length + 1, (batch, i) => {
      if (i === tasks.length) batch.delete(ref('labels', id));
      else batch.set(ref('tasks', tasks[i].id), { ...tasks[i], labelIds: tasks[i].labelIds.filter((l) => l !== id) });
    });
  },
};

// ---- Tasks ----

async function validateTask(input: TaskInput, id?: string) {
  const errors: Record<string, string[]> = {};
  if (!input.content?.trim()) errors.content = ['Content is required.'];
  if (input.priority !== undefined && (input.priority < 1 || input.priority > 4)) errors.priority = ['Priority must be between 1 and 4.'];
  if (input.durationMinutes != null && (input.durationMinutes < 5 || input.durationMinutes > 1440))
    errors.durationMinutes = ['Duration must be between 5 and 1440 minutes.'];
  if (input.dueDate && (!DATE_RE.test(input.dueDate) || !parseDateStr(input.dueDate))) errors.dueDate = ['Due date must be yyyy-MM-dd.'];
  if (input.dueTime && !TIME_RE.test(input.dueTime)) errors.dueTime = ['Due time must be HH:mm.'];
  if (id && input.parentId === id) errors.parentId = ['A task cannot be its own parent.'];

  const [project, section, parent] = await Promise.all([
    one<Project>('projects', input.projectId),
    input.sectionId ? one<Section>('sections', input.sectionId) : Promise.resolve(undefined),
    input.parentId ? one<Task>('tasks', input.parentId) : Promise.resolve(undefined),
  ]);
  if (!project) errors.projectId = ['Project does not exist.'];
  if (section === null) errors.sectionId = ['Section does not exist.'];
  if (parent === null) errors.parentId = ['Parent task does not exist.'];
  if (Object.keys(errors).length) invalid(errors);
}

function applyTask(task: Task, input: TaskInput): Task {
  const dueDate = input.dueDate || null;
  return {
    ...task,
    content: input.content.trim(),
    description: input.description?.trim() ?? '',
    projectId: input.projectId,
    sectionId: input.sectionId || null,
    parentId: input.parentId || null,
    labelIds: [...new Set(input.labelIds ?? [])],
    priority: input.priority ?? 4,
    dueDate,
    dueTime: dueDate && input.dueTime ? input.dueTime : null,
    durationMinutes: input.durationMinutes ?? null,
    recurrence: dueDate ? (input.recurrence ?? 'none') : 'none',
    updatedAt: nowIso(),
  };
}

/** Next occurrence after completing a recurring task: step forward until the date is after today. */
function nextOccurrence(dueDate: string, recurrence: Task['recurrence']): string {
  const today = toDateStr(new Date());
  let next = stepDate(parseDateStr(dueDate)!, recurrence);
  while (toDateStr(next) <= today) next = stepDate(next, recurrence);
  return toDateStr(next);
}

const completionOf = (task: Task, completedAt: string): Completion => ({
  id: newId(),
  taskId: task.id,
  content: task.content,
  projectId: task.projectId,
  completedAt,
});

const tasks: Api['tasks'] = {
  listActive: async () => {
    const snap = await getDocs(query(userCollection('tasks'), where('isCompleted', '==', false)));
    return sortActiveTasks(snap.docs.map((d) => d.data() as Task));
  },

  listCompleted: async (max = 500) => {
    const snap = await getDocs(query(userCollection('tasks'), where('isCompleted', '==', true)));
    return sortCompletedTasks(snap.docs.map((d) => d.data() as Task), max);
  },

  create: async (input: TaskInput) => {
    await validateTask(input);
    let order = input.order;
    if (order === undefined) {
      const siblings = await tasksWhere('projectId', input.projectId);
      order = Math.max(-1, ...siblings.map((t) => t.order)) + 1;
    }
    const created = nowIso();
    const task = applyTask(
      {
        id: newId(),
        content: '',
        description: '',
        projectId: input.projectId,
        sectionId: null,
        parentId: null,
        labelIds: [],
        priority: 4,
        dueDate: null,
        dueTime: null,
        durationMinutes: null,
        recurrence: 'none',
        isCompleted: false,
        completedAt: null,
        order,
        createdAt: created,
        updatedAt: created,
      },
      input,
    );
    await setDoc(ref('tasks', task.id), task);
    return task;
  },

  update: async (id: string, input: TaskInput) => {
    await validateTask(input, id);
    const task = (await one<Task>('tasks', id)) ?? notFound();
    const next = applyTask(task, input);
    if (input.order !== undefined) next.order = input.order;
    // Subtasks follow their parent when it moves to another project or section.
    const children = await tasksWhere('parentId', id);
    await batched(children.length + 1, (batch, i) => {
      if (i === children.length) batch.set(ref('tasks', id), next);
      else batch.set(ref('tasks', children[i].id), { ...children[i], projectId: next.projectId, sectionId: next.sectionId });
    });
    return next;
  },

  remove: async (id: string) => {
    if (!(await one<Task>('tasks', id))) notFound();
    const children = await tasksWhere('parentId', id);
    const refs = [ref('tasks', id), ...children.map((c) => ref('tasks', c.id))];
    await batched(refs.length, (batch, i) => batch.delete(refs[i]));
  },

  complete: async (id: string) => {
    const task = (await one<Task>('tasks', id)) ?? notFound();
    const now = nowIso();

    // Recurring tasks are not closed; they roll forward, but the completion still counts.
    if (task.recurrence !== 'none' && task.dueDate && parseDateStr(task.dueDate)) {
      const next: Task = { ...task, dueDate: nextOccurrence(task.dueDate, task.recurrence), updatedAt: now };
      const log = completionOf(task, now);
      const batch = writeBatch(firebase().db);
      batch.set(ref('completions', log.id), log);
      batch.set(ref('tasks', id), next);
      await batch.commit();
      return next;
    }

    const openChildren = (await tasksWhere('parentId', id)).filter((c) => !c.isCompleted);
    const closed = [task, ...openChildren].map((t) => ({ ...t, isCompleted: true, completedAt: now, updatedAt: now }));
    const logs = [task, ...openChildren].map((t) => completionOf(t, now));
    await batched(closed.length + logs.length, (batch, i) => {
      if (i < closed.length) batch.set(ref('tasks', closed[i].id), closed[i]);
      else batch.set(ref('completions', logs[i - closed.length].id), logs[i - closed.length]);
    });
    return closed[0];
  },

  reopen: async (id: string) => {
    const task = (await one<Task>('tasks', id)) ?? notFound();
    const now = nowIso();
    const reopened: Task = { ...task, isCompleted: false, completedAt: null, updatedAt: now };
    const batch = writeBatch(firebase().db);
    batch.set(ref('tasks', id), reopened);

    // Undo the latest completion log entry so history matches what the user sees.
    const logs = await getDocs(query(userCollection('completions'), where('taskId', '==', id)));
    const latest = logs.docs.map((d) => d.data() as Completion).sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    if (latest) batch.delete(ref('completions', latest.id));

    // A reopened subtask needs its parent visible again.
    const parent = task.parentId ? await one<Task>('tasks', task.parentId) : null;
    if (parent) batch.set(ref('tasks', parent.id), { ...parent, isCompleted: false, completedAt: null, updatedAt: now });

    await batch.commit();
    return reopened;
  },

  reorder: async (items: ReorderItem[]) => {
    if (items.length === 0) return;
    const now = nowIso();
    const found = (await Promise.all(items.map((item) => one<Task>('tasks', item.id)))).map((task, i) => ({ task, item: items[i] }));
    const updates = found.flatMap(({ task, item }) => {
      if (!task) return [];
      const next: Task = { ...task, order: item.order, updatedAt: now };
      if (item.sectionId != null) next.sectionId = item.sectionId === '' ? null : item.sectionId;
      if (item.parentId != null) next.parentId = item.parentId === '' ? null : item.parentId;
      return [next];
    });
    await batched(updates.length, (batch, i) => batch.set(ref('tasks', updates[i].id), updates[i]));
  },
};

// ---- Stats ----

const stats: Api['stats'] = {
  completions: async (from: string, to: string) => {
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from)
      invalid({ range: ['from and to must be yyyy-MM-dd with to on or after from.'] });
    // Local calendar days: widen the UTC window by 14 hours each side; the client buckets by local date.
    const start = new Date(new Date(`${from}T00:00:00Z`).getTime() - 14 * 3_600_000).toISOString();
    const end = new Date(new Date(`${to}T23:59:59.999Z`).getTime() + 14 * 3_600_000).toISOString();
    const [inRange, first] = await Promise.all([
      getDocs(query(userCollection('completions'), where('completedAt', '>=', start), where('completedAt', '<=', end), orderBy('completedAt'))),
      getDocs(query(userCollection('completions'), orderBy('completedAt'), limit(1))),
    ]);
    const items = inRange.docs.map((d) => {
      const c = d.data() as Completion;
      return { taskId: c.taskId, content: c.content, projectId: c.projectId, completedAt: c.completedAt };
    });
    const years: number[] = [];
    const earliest = first.docs[0]?.data() as Completion | undefined;
    if (earliest) {
      for (let y = new Date(earliest.completedAt).getUTCFullYear(); y <= new Date().getUTCFullYear(); y++) years.push(y);
    }
    return { years, items };
  },
};

// ---- Backup ----

const backup: Api['backup'] = {
  export: async () => {
    const [p, s, l, t, c, n] = await Promise.all([
      all<Project>('projects'),
      all<Section>('sections'),
      all<Label>('labels'),
      all<Task>('tasks'),
      all<Completion>('completions'),
      all<Note>('notes'),
    ]);
    const document: BackupDocument = { app: 'MyTodoEase', version: 1, exportedAt: nowIso(), projects: p, sections: s, labels: l, tasks: t, completions: c, notes: n };
    return document;
  },

  import: async (raw: unknown) => {
    const docIn = raw as Partial<BackupDocument> | null;
    if (!docIn || typeof docIn !== 'object') invalid({ file: ['Not a TodoEase backup.'] });
    const errors: Record<string, string[]> = {};
    if (String(docIn.app).toLowerCase() !== 'mytodoease') errors.file = ['Not a TodoEase backup.'];
    if (typeof docIn.version !== 'number' || docIn.version < 1 || docIn.version > 1)
      errors.version = [`Backup version ${docIn.version} is not supported by this app.`];

    let projectsIn = (docIn.projects ?? []) as Project[];
    let sectionsIn = (docIn.sections ?? []) as Section[];
    const labelsIn = (docIn.labels ?? []) as Label[];
    let tasksIn = (docIn.tasks ?? []) as Task[];
    const completionsIn = (docIn.completions ?? []) as Completion[];
    const notesIn = (docIn.notes ?? []) as Note[];

    const seen = new Set<string>();
    const checkIds = (field: string, rows: { id: string }[]) => {
      for (const row of rows) {
        if (!isValidId(row.id)) { errors[field] = ['Contains an invalid id.']; return; }
        if (seen.has(row.id)) { errors[field] = [`Duplicate id ${row.id}.`]; return; }
        seen.add(row.id);
      }
    };
    checkIds('projects', projectsIn);
    checkIds('sections', sectionsIn);
    checkIds('labels', labelsIn);
    checkIds('tasks', tasksIn);
    checkIds('completions', completionsIn);
    checkIds('notes', notesIn);
    if (Object.keys(errors).length) invalid(errors);

    // References to rows missing from the file are dropped rather than rejected.
    const projectIds = new Set(projectsIn.map((p) => p.id));
    const sectionIds = new Set(sectionsIn.map((s) => s.id));
    const labelIds = new Set(labelsIn.map((l) => l.id));
    const taskIds = new Set(tasksIn.map((t) => t.id));
    sectionsIn = sectionsIn.filter((s) => projectIds.has(s.projectId)).map((s) => ({ ...s, name: s.name ?? '' }));
    tasksIn = tasksIn
      .filter((t) => projectIds.has(t.projectId))
      .map((t) => ({
        ...t,
        sectionId: t.sectionId && sectionIds.has(t.sectionId) ? t.sectionId : null,
        parentId: t.parentId && taskIds.has(t.parentId) ? t.parentId : null,
        labelIds: [...new Set((t.labelIds ?? []).filter((l) => labelIds.has(l)))],
        content: t.content ?? '',
        description: t.description ?? '',
        priority: t.priority >= 1 && t.priority <= 4 ? t.priority : 4,
        dueDate: t.dueDate ?? null,
        dueTime: t.dueTime ?? null,
        durationMinutes: t.durationMinutes ?? null,
        recurrence: t.recurrence ?? 'none',
        isCompleted: Boolean(t.isCompleted),
        completedAt: t.completedAt ?? null,
      }));
    projectsIn = projectsIn.map((p) => ({ ...p, name: p.name ?? '', color: p.color ?? 'grey', isInbox: Boolean(p.isInbox), isFavorite: Boolean(p.isFavorite) }));
    const labelsOut = labelsIn.map((l) => ({ ...l, name: l.name ?? '', color: l.color ?? 'grey' }));
    const completionsOut = completionsIn.map((c) => ({ ...c, content: c.content ?? '' }));
    const notesOut: Note[] = notesIn.map((n) => ({
      id: n.id,
      text: n.text ?? '',
      color: NOTE_COLOR_SET.has(n.color) ? n.color : 'yellow',
      order: typeof n.order === 'number' ? n.order : 0,
      isArchived: Boolean(n.isArchived),
      taskIds: [...new Set((n.taskIds ?? []).filter(isValidId))],
      x: typeof n.x === 'number' ? n.x : null,
      y: typeof n.y === 'number' ? n.y : null,
      w: typeof n.w === 'number' ? n.w : null,
      h: typeof n.h === 'number' ? n.h : null,
      createdAt: n.createdAt ?? nowIso(),
      updatedAt: n.updatedAt ?? nowIso(),
    }));

    // Exactly one Inbox: keep the first flagged one, or add one when the file has none.
    let inboxSeen = false;
    projectsIn = projectsIn.map((p) => {
      if (!p.isInbox) return p;
      if (inboxSeen) return { ...p, isInbox: false };
      inboxSeen = true;
      return p;
    });
    if (!inboxSeen) {
      projectsIn.unshift({ id: newId(), name: 'Inbox', color: 'grey', isInbox: true, isFavorite: false, order: -1, createdAt: nowIso() });
    }

    // Replace everything: delete what is there, then write the file's rows.
    const existing = await Promise.all(
      (['projects', 'sections', 'labels', 'tasks', 'completions', 'notes'] as CollectionName[]).map(async (name) => (await getDocs(userCollection(name))).docs.map((d) => d.ref)),
    );
    const deletes = existing.flat();
    await batched(deletes.length, (batch, i) => batch.delete(deletes[i]));

    const writes: { ref: DocumentReference; data: object }[] = [
      ...projectsIn.map((p) => ({ ref: ref('projects', p.id), data: p })),
      ...sectionsIn.map((s) => ({ ref: ref('sections', s.id), data: s })),
      ...labelsOut.map((l) => ({ ref: ref('labels', l.id), data: l })),
      ...tasksIn.map((t) => ({ ref: ref('tasks', t.id), data: t })),
      ...completionsOut.map((c) => ({ ref: ref('completions', c.id), data: c })),
      ...notesOut.map((n) => ({ ref: ref('notes', n.id), data: n })),
    ];
    await batched(writes.length, (batch, i) => batch.set(writes[i].ref, writes[i].data));

    return { projects: projectsIn.length, sections: sectionsIn.length, labels: labelsOut.length, tasks: tasksIn.length, completions: completionsOut.length, notes: notesOut.length };
  },
};

// ---- Account (Firebase Auth) and desktop-only features ----

function authStatus(user: User | null): GoogleAuthStatus {
  if (!user) return { configured: true, clientId: null, signedIn: false, account: null, pending: false };
  return {
    configured: true,
    clientId: null,
    signedIn: true,
    account: {
      email: user.email ?? '',
      name: user.displayName ?? user.email ?? 'Google account',
      picture: user.photoURL,
      scopes: [],
      connectedAt: user.metadata.creationTime ?? '',
    },
    pending: false,
  };
}

/** Resolves once Firebase has restored (or ruled out) a persisted session. */
function authReady(): Promise<User | null> {
  const { auth } = firebase();
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user);
    });
  });
}

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(firebase().auth, googleProvider());
  return result.user;
}

const googleAuth: Api['googleAuth'] = {
  status: async () => authStatus(await authReady()),
  configure: async () => {
    throw new ApiError(400, 'The web app signs in with Firebase; no OAuth client to configure.');
  },
  start: async () => {
    await signInWithGoogle();
    return { url: '' };
  },
  cancel: async () => undefined,
  signOut: async () => {
    await firebaseSignOut(firebase().auth);
    return authStatus(null);
  },
};

// ---- Google Calendar (cloud mode: the sync runs in this app on demand and lands in Firestore) ----

const calendarSyncDoc = (name: 'settings' | 'status' | 'calendars'): DocumentReference => doc(userDoc(), 'calendarSync', name);

const calendar: Api['calendar'] = {
  syncStatus: async () => calendarStatusFrom((await getDoc(calendarSyncDoc('status'))).data()),

  // Settings are written first, then a sync applies them (mirror on/off, chosen calendars) and reports back.
  updateSync: async (input) => {
    const patch: Record<string, unknown> = {};
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.sourceCalendarIds) patch.sourceCalendarIds = [...new Set(input.sourceCalendarIds)];
    await setDoc(calendarSyncDoc('settings'), patch, { merge: true });
    return runCalendarSync(getCalendarAccessToken);
  },

  runSync: () => runCalendarSync(getCalendarAccessToken),

  calendars: async () => {
    const snap = await getDoc(calendarSyncDoc('calendars'));
    return snap.exists() ? ((snap.data().items as GoogleCalendarInfo[] | undefined) ?? []) : [];
  },

  // A sync keeps about two weeks back and three months ahead; outside that window there is nothing stored.
  events: async (from: string, to: string) => {
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) invalid({ range: ['from and to must be yyyy-MM-dd.'] });
    const snap = await getDocs(userCollection('calendarEvents'));
    return snap.docs
      .map((d) => d.data() as ExternalEvent)
      .filter((e) => e.date <= to && e.endDate >= from)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  },

  disconnect: async () => {
    await disconnectCloudCalendar();
  },
};

export { connectCalendar };

export const firestoreApi: Api = {
  health: async () => ({ status: 'ok', storage: `Firebase project ${firebase().projectId} (synced to your Google account)` }),
  googleAuth,
  calendar,
  backup,
  projects,
  sections,
  labels,
  notes,
  tasks,
  stats,
};

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { api, taskToInput, type Priority, type Recurrence, type Task, type TaskInput } from "../api.js";
import { fitPage, formatTask, formatTaskList } from "../format.js";
import {
  loadWorkspace,
  normalizeDate,
  resolveLabel,
  resolveOrCreateLabels,
  resolveProject,
  resolveSection,
  todayStr,
  type Workspace
} from "../lookup.js";

const RECURRENCES = ["none", "daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"] as const;
const VIEWS = ["today", "upcoming", "overdue", "inbox", "no_date", "all"] as const;

const ResponseFormat = z.enum(["markdown", "json"]).default("markdown").describe("'markdown' for readable text, 'json' for structured data");

const dueDateField = z
  .string()
  .describe("Due date: yyyy-MM-dd, 'today' or 'tomorrow'. Use an empty string to clear it.");
const dueTimeField = z.string().regex(/^\d{2}:\d{2}$/).describe("Due time HH:mm (24h); only meaningful with a due date");
const priorityField = z.number().int().min(1).max(4).describe("1 = highest (P1) … 4 = none (P4, default)");
const recurrenceField = z.enum(RECURRENCES).describe("Repeat rule; completing a recurring task rolls it to the next date instead of closing it");
const labelsField = z.array(z.string()).describe("Label names (with or without @) or ids; unknown names are created");

const sortForAgenda = (a: Task, b: Task) => {
  const ad = a.dueDate ?? "9999";
  const bd = b.dueDate ?? "9999";
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = a.dueTime ?? "99:99";
  const bt = b.dueTime ?? "99:99";
  if (at !== bt) return at < bt ? -1 : 1;
  return a.priority - b.priority || a.order - b.order;
};

function taskJson(task: Task, ws: Workspace) {
  const project = ws.projects.find((p) => p.id === task.projectId);
  return {
    ...task,
    projectName: project?.isInbox ? "Inbox" : (project?.name ?? null),
    sectionName: task.sectionId ? (ws.sections.find((s) => s.id === task.sectionId)?.name ?? null) : null,
    labels: task.labelIds.map((id) => ws.labels.find((l) => l.id === id)?.name).filter(Boolean)
  };
}

function taskResult(task: Task, ws: Workspace, format: "markdown" | "json", heading?: string) {
  if (format === "json") {
    const data = taskJson(task, ws);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
  }
  return { content: [{ type: "text" as const, text: `${heading ? `${heading}\n` : ""}${formatTask(task, ws)}` }] };
}

export function registerTaskTools(server: McpServer): void {
  server.registerTool(
    "mytodoease_list_tasks",
    {
      title: "List tasks",
      description: `List the user's tasks, filtered by a view, project, label or search text.

Views: today (due today or overdue), upcoming (next 7 days plus overdue), overdue, inbox, no_date, all (every open task).
Combine filters freely, e.g. view="upcoming" with project="Rehab". Set include_completed=true to see finished tasks too (newest first).
Each line shows the task id needed by other tools. Sub-tasks are indented under their parent.

Examples:
  - "What's on my plate today?" -> view="today"
  - "Show the Rehab release tasks" -> project="Rehab", search="release"
  - "What did I finish this week?" -> include_completed=true, view="all"`,
      inputSchema: z.strictObject({
        view: z.enum(VIEWS).default("all").describe("Which slice of tasks to show"),
        project: z.string().optional().describe("Project name or id; 'Inbox' for the inbox"),
        label: z.string().optional().describe("Label name (with or without @) or id"),
        search: z.string().optional().describe("Case-insensitive text to match in the task content or description"),
        include_completed: z.boolean().default(false).describe("Also include completed tasks"),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum number of tasks to return"),
        offset: z.number().int().min(0).default(0).describe("Number of tasks to skip, for pagination"),
        response_format: ResponseFormat
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ view, project, label, search, include_completed, limit, offset, response_format }, ctx) => {
      const signal = ctx.mcpReq.signal;
      const ws = await loadWorkspace(signal);
      let tasks = await api<Task[]>("GET", "/api/tasks", undefined, signal);
      if (include_completed) {
        const done = await api<Task[]>("GET", "/api/tasks?completed=true&limit=1000", undefined, signal);
        tasks = [...tasks, ...done];
      }

      const today = todayStr();
      const weekEnd = todayStr(7);
      switch (view) {
        case "today":
          tasks = tasks.filter((t) => t.dueDate !== null && t.dueDate <= today);
          break;
        case "upcoming":
          tasks = tasks.filter((t) => t.dueDate !== null && t.dueDate <= weekEnd);
          break;
        case "overdue":
          tasks = tasks.filter((t) => t.dueDate !== null && t.dueDate < today && !t.isCompleted);
          break;
        case "inbox": {
          const inbox = ws.projects.find((p) => p.isInbox);
          tasks = tasks.filter((t) => t.projectId === inbox?.id);
          break;
        }
        case "no_date":
          tasks = tasks.filter((t) => t.dueDate === null);
          break;
        default:
          break;
      }
      if (project) {
        const p = resolveProject(ws, project);
        tasks = tasks.filter((t) => t.projectId === p.id);
      }
      if (label) {
        const l = resolveLabel(ws, label);
        if (!l) throw new Error(`No label matches "${label}". Existing labels: ${ws.labels.map((x) => x.name).join(", ") || "(none)"}.`);
        tasks = tasks.filter((t) => t.labelIds.includes(l.id));
      }
      if (search) {
        const q = search.toLowerCase();
        tasks = tasks.filter((t) => (t.content ?? "").toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q));
      }
      tasks.sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || sortForAgenda(a, b));

      const total = tasks.length;
      const window = tasks.slice(offset, offset + limit);
      const render = (slice: Task[]) => {
        const nextOffset = offset + slice.length;
        const hasMore = total > nextOffset;
        const page = {
          total,
          count: slice.length,
          offset,
          tasks: slice.map((t) => taskJson(t, ws)),
          has_more: hasMore,
          ...(hasMore ? { next_offset: nextOffset } : {})
        };
        if (response_format === "json") return { page, text: JSON.stringify(page, null, 2) };
        const title = `# Tasks (${view}${project ? `, #${project}` : ""}${label ? `, @${label}` : ""}${search ? `, "${search}"` : ""})`;
        const lines = [title, `Showing ${slice.length} of ${total}. Today is ${today}.`, "", formatTaskList(slice, ws)];
        if (hasMore) lines.push("", `More tasks: call again with offset=${nextOffset}.`);
        return { page, text: lines.join("\n") };
      };
      const fitted = fitPage(window, (slice) => render(slice).text);
      const result = render(fitted.items);
      if (response_format === "json") {
        return { content: [{ type: "text", text: result.text }], structuredContent: result.page };
      }
      if (total === 0) {
        return { content: [{ type: "text", text: `No tasks match (view=${view}${project ? `, project=${project}` : ""}${label ? `, label=${label}` : ""}${search ? `, search="${search}"` : ""}).` }] };
      }
      return { content: [{ type: "text", text: result.text }] };
    }
  );

  server.registerTool(
    "mytodoease_get_task",
    {
      title: "Get task",
      description: "Get one task by id, with its description, project, section, labels and sub-tasks.",
      inputSchema: z.strictObject({
        task_id: z.string().min(1).describe("Task id (24 hex characters) from mytodoease_list_tasks"),
        response_format: ResponseFormat
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ task_id, response_format }, ctx) => {
      const signal = ctx.mcpReq.signal;
      const [ws, task, all] = await Promise.all([
        loadWorkspace(signal),
        api<Task>("GET", `/api/tasks/${encodeURIComponent(task_id)}`, undefined, signal),
        api<Task[]>("GET", "/api/tasks", undefined, signal)
      ]);
      const children = all.filter((t) => t.parentId === task.id);
      if (response_format === "json") {
        const data = { ...taskJson(task, ws), subtasks: children.map((c) => taskJson(c, ws)) };
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
      }
      const lines = [formatTask(task, ws)];
      for (const child of children) lines.push(formatTask(child, ws, { indent: 2 }));
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "mytodoease_create_task",
    {
      title: "Create task",
      description: `Create a task. Only content is required; everything else defaults sensibly (Inbox, no date, P4, no repeat).

Projects, sections and labels can be given by name; unknown labels are created. For a sub-task pass parent_task_id.

Examples:
  - "Remind me to call the dentist tomorrow" -> content="Call the dentist", due_date="tomorrow"
  - "Add 'Release Live' to Rehab every two weeks from 2026-10-28" -> content="Release Live", project="Rehab", due_date="2026-10-28", recurrence="biweekly"`,
      inputSchema: z.strictObject({
        content: z.string().min(1).max(500).describe("Task title"),
        description: z.string().max(5000).optional().describe("Longer notes, Markdown allowed"),
        project: z.string().optional().describe("Project name or id; defaults to Inbox"),
        section: z.string().optional().describe("Section name or id inside the project"),
        parent_task_id: z.string().optional().describe("Make this a sub-task of that task"),
        labels: labelsField.optional(),
        priority: priorityField.optional(),
        due_date: dueDateField.optional(),
        due_time: dueTimeField.optional(),
        recurrence: recurrenceField.optional(),
        response_format: ResponseFormat
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async (args, ctx) => {
      const signal = ctx.mcpReq.signal;
      const ws = await loadWorkspace(signal);
      const project = resolveProject(ws, args.project);
      const section = resolveSection(ws, project, args.section);
      const input: TaskInput = {
        content: args.content,
        description: args.description ?? "",
        projectId: project.id,
        sectionId: section?.id ?? null,
        parentId: args.parent_task_id ?? null,
        labelIds: await resolveOrCreateLabels(ws, args.labels, signal),
        priority: (args.priority as Priority | undefined) ?? 4,
        dueDate: normalizeDate(args.due_date) ?? null,
        dueTime: args.due_time ?? null,
        recurrence: (args.recurrence as Recurrence | undefined) ?? "none"
      };
      const task = await api<Task>("POST", "/api/tasks", input, signal);
      return taskResult(task, ws, args.response_format, "Created:");
    }
  );

  server.registerTool(
    "mytodoease_update_task",
    {
      title: "Update task",
      description: `Change one or more fields of a task; fields you leave out stay as they are.

Use it to reschedule (due_date), move between projects/sections, change priority, set a repeat rule, rename, or edit labels.
Pass due_date="" to remove the date, section="" to move the task to the project root, labels=[] to clear labels.`,
      inputSchema: z.strictObject({
        task_id: z.string().min(1).describe("Task id from mytodoease_list_tasks"),
        content: z.string().min(1).max(500).optional().describe("New title"),
        description: z.string().max(5000).optional().describe("New notes (replaces the old ones)"),
        project: z.string().optional().describe("Move to this project (name or id)"),
        section: z.string().optional().describe("Move to this section (name or id); empty string = project root"),
        labels: labelsField.optional().describe("Replace the labels with these names/ids; [] clears them"),
        priority: priorityField.optional(),
        due_date: dueDateField.optional(),
        due_time: dueTimeField.optional().describe("Due time HH:mm; empty string clears it"),
        recurrence: recurrenceField.optional(),
        response_format: ResponseFormat
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (args, ctx) => {
      const signal = ctx.mcpReq.signal;
      const [ws, current] = await Promise.all([
        loadWorkspace(signal),
        api<Task>("GET", `/api/tasks/${encodeURIComponent(args.task_id)}`, undefined, signal)
      ]);
      const input = taskToInput(current);
      if (args.content !== undefined) input.content = args.content;
      if (args.description !== undefined) input.description = args.description;
      let project = ws.projects.find((p) => p.id === current.projectId);
      if (args.project !== undefined) {
        project = resolveProject(ws, args.project);
        input.projectId = project.id;
        if (project.id !== current.projectId && args.section === undefined) input.sectionId = null;
      }
      if (args.section !== undefined) {
        input.sectionId = args.section === "" ? null : (resolveSection(ws, project ?? resolveProject(ws, undefined), args.section)?.id ?? null);
      }
      if (args.labels !== undefined) input.labelIds = await resolveOrCreateLabels(ws, args.labels, signal);
      if (args.priority !== undefined) input.priority = args.priority as Priority;
      if (args.due_date !== undefined) input.dueDate = normalizeDate(args.due_date) ?? null;
      if (args.due_time !== undefined) input.dueTime = args.due_time === "" ? null : args.due_time;
      if (args.recurrence !== undefined) input.recurrence = args.recurrence as Recurrence;
      const task = await api<Task>("PUT", `/api/tasks/${encodeURIComponent(args.task_id)}`, input, signal);
      return taskResult(task, ws, args.response_format, "Updated:");
    }
  );

  server.registerTool(
    "mytodoease_complete_task",
    {
      title: "Complete task",
      description:
        "Mark a task done. Open sub-tasks are completed with it. A recurring task is not closed: it rolls to its next date and the completion is still logged.",
      inputSchema: z.strictObject({ task_id: z.string().min(1).describe("Task id"), response_format: ResponseFormat }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ task_id, response_format }, ctx) => {
      const signal = ctx.mcpReq.signal;
      const [ws, task] = await Promise.all([
        loadWorkspace(signal),
        api<Task>("POST", `/api/tasks/${encodeURIComponent(task_id)}/complete`, undefined, signal)
      ]);
      const heading = task.isCompleted ? "Completed:" : `Completed; rolled forward to ${task.dueDate}:`;
      return taskResult(task, ws, response_format, heading);
    }
  );

  server.registerTool(
    "mytodoease_reopen_task",
    {
      title: "Reopen task",
      description: "Undo a completion: the task becomes open again and its latest completion log entry is removed.",
      inputSchema: z.strictObject({ task_id: z.string().min(1).describe("Task id"), response_format: ResponseFormat }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ task_id, response_format }, ctx) => {
      const signal = ctx.mcpReq.signal;
      const [ws, task] = await Promise.all([
        loadWorkspace(signal),
        api<Task>("POST", `/api/tasks/${encodeURIComponent(task_id)}/reopen`, undefined, signal)
      ]);
      return taskResult(task, ws, response_format, "Reopened:");
    }
  );

  server.registerTool(
    "mytodoease_delete_task",
    {
      title: "Delete task",
      description: "Permanently delete a task and its sub-tasks. Prefer mytodoease_complete_task unless the user clearly wants it gone.",
      inputSchema: z.strictObject({ task_id: z.string().min(1).describe("Task id") }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ task_id }, ctx) => {
      await api<void>("DELETE", `/api/tasks/${encodeURIComponent(task_id)}`, undefined, ctx.mcpReq.signal);
      return { content: [{ type: "text", text: `Deleted task ${task_id}.` }] };
    }
  );
}

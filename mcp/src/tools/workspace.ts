import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { api, type CompletionsResponse, type Label, type Project, type Section, type Task } from "../api.js";
import { fitPage, formatCompletion, formatLabel, formatProject } from "../format.js";
import { loadWorkspace, normalizeDate, resolveProject, todayStr } from "../lookup.js";

const ResponseFormat = z.enum(["markdown", "json"]).default("markdown").describe("'markdown' for readable text, 'json' for structured data");

const COLORS = [
  "berry_red", "red", "orange", "yellow", "olive_green", "green", "mint_green", "teal", "sky_blue",
  "blue", "grape", "violet", "magenta", "salmon", "charcoal", "grey", "taupe"
] as const;
const colorField = z.enum(COLORS).optional().describe("Color name; defaults to grey");

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    "mytodoease_list_projects",
    {
      title: "List projects and labels",
      description:
        "List every project (with its sections and open-task count) and every label. Call this first when you need a project, section or label id, or to see how the user organises their work.",
      inputSchema: z.strictObject({ response_format: ResponseFormat }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }, ctx) => {
      const signal = ctx.mcpReq.signal;
      const [ws, tasks] = await Promise.all([loadWorkspace(signal), api<Task[]>("GET", "/api/tasks", undefined, signal)]);
      const projectCounts = new Map<string, number>();
      const labelCounts = new Map<string, number>();
      for (const t of tasks) {
        projectCounts.set(t.projectId, (projectCounts.get(t.projectId) ?? 0) + 1);
        for (const id of t.labelIds) labelCounts.set(id, (labelCounts.get(id) ?? 0) + 1);
      }
      if (response_format === "json") {
        const data = {
          projects: ws.projects.map((p) => ({
            ...p,
            openTasks: projectCounts.get(p.id) ?? 0,
            sections: ws.sections.filter((s) => s.projectId === p.id)
          })),
          labels: ws.labels.map((l) => ({ ...l, openTasks: labelCounts.get(l.id) ?? 0 }))
        };
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
      }
      const lines = ["# Projects", ...ws.projects.map((p) => formatProject(p, ws.sections, projectCounts)), "", "# Labels"];
      lines.push(ws.labels.length ? ws.labels.map((l) => formatLabel(l, labelCounts.get(l.id) ?? 0)).join("\n") : "(no labels yet)");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "mytodoease_create_project",
    {
      title: "Create project",
      description: "Create a project. Use mytodoease_list_projects first to avoid duplicates.",
      inputSchema: z.strictObject({
        name: z.string().min(1).max(100).describe("Project name"),
        color: colorField,
        favorite: z.boolean().default(false).describe("Pin it as a favourite")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ name, color, favorite }, ctx) => {
      const project = await api<Project>("POST", "/api/projects", { name, color, isFavorite: favorite }, ctx.mcpReq.signal);
      return { content: [{ type: "text", text: `Created project ${project.name} (id: ${project.id}).` }] };
    }
  );

  server.registerTool(
    "mytodoease_create_section",
    {
      title: "Create section",
      description: "Create a section inside a project (project by name or id).",
      inputSchema: z.strictObject({
        project: z.string().min(1).describe("Project name or id"),
        name: z.string().min(1).max(100).describe("Section name")
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ project, name }, ctx) => {
      const signal = ctx.mcpReq.signal;
      const ws = await loadWorkspace(signal);
      const p = resolveProject(ws, project);
      const section = await api<Section>("POST", "/api/sections", { projectId: p.id, name }, signal);
      return { content: [{ type: "text", text: `Created section ${section.name} (id: ${section.id}) in ${p.name}.` }] };
    }
  );

  server.registerTool(
    "mytodoease_create_label",
    {
      title: "Create label",
      description: "Create a label. Creating a name that already exists returns the existing label.",
      inputSchema: z.strictObject({
        name: z.string().min(1).max(60).describe("Label name without the @"),
        color: colorField
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ name, color }, ctx) => {
      const label = await api<Label>("POST", "/api/labels", { name: name.replace(/^@/, ""), color }, ctx.mcpReq.signal);
      return { content: [{ type: "text", text: `Label @${label.name} (id: ${label.id}).` }] };
    }
  );

  server.registerTool(
    "mytodoease_completion_history",
    {
      title: "Completion history",
      description:
        "What the user completed between two dates (inclusive, yyyy-MM-dd, 'today', 'tomorrow'). Defaults to the last 7 days. Includes recurring completions and tasks deleted since. Useful for reviews, stand-ups and streaks.",
      inputSchema: z.strictObject({
        from: z.string().optional().describe("Start date; defaults to 6 days ago"),
        to: z.string().optional().describe("End date; defaults to today"),
        project: z.string().optional().describe("Only this project (name or id)"),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
        response_format: ResponseFormat
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ from, to, project, limit, offset, response_format }, ctx) => {
      const signal = ctx.mcpReq.signal;
      const fromStr = normalizeDate(from) ?? todayStr(-6);
      const toStr = normalizeDate(to) ?? todayStr();
      const [ws, data] = await Promise.all([
        loadWorkspace(signal),
        api<CompletionsResponse>("GET", `/api/stats/completions?from=${fromStr}&to=${toStr}`, undefined, signal)
      ]);
      let items = data.items;
      if (project) {
        const p = resolveProject(ws, project);
        items = items.filter((i) => i.projectId === p.id);
      }
      items = [...items].reverse(); // newest first
      const total = items.length;
      const window = items.slice(offset, offset + limit);
      const render = (slice: typeof window) => {
        const nextOffset = offset + slice.length;
        const hasMore = total > nextOffset;
        const page = { from: fromStr, to: toStr, total, count: slice.length, offset, items: slice, has_more: hasMore, ...(hasMore ? { next_offset: nextOffset } : {}) };
        if (response_format === "json") return { page, text: JSON.stringify(page, null, 2) };
        const lines = [`# Completed ${fromStr} to ${toStr}`, `${total} completion${total === 1 ? "" : "s"}.`, "", slice.map((i) => formatCompletion(i, ws)).join("\n")];
        if (hasMore) lines.push("", `More: call again with offset=${nextOffset}.`);
        return { page, text: lines.join("\n") };
      };
      const fitted = fitPage(window, (slice) => render(slice).text);
      const result = render(fitted.items);
      if (response_format === "json") return { content: [{ type: "text", text: result.text }], structuredContent: result.page };
      if (total === 0) return { content: [{ type: "text", text: `Nothing completed between ${fromStr} and ${toStr}.` }] };
      return { content: [{ type: "text", text: result.text }] };
    }
  );
}

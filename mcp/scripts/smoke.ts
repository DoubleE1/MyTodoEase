/**
 * Self-check: starts the built server over stdio, exercises every tool against the API named by
 * MYTODOEASE_API_URL (point it at a scratch database), and exits non-zero on any failure.
 * Run with: npm run build && npm run smoke
 */
import { strict as assert } from "node:assert";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const apiUrl = process.env.MYTODOEASE_API_URL ?? "http://localhost:5081";
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...getDefaultEnvironment(), MYTODOEASE_API_URL: apiUrl }
  })
);

type Result = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: unknown };
const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result;
const text = (r: Result) => r.content.map((c) => c.text ?? "").join("\n");
const ok = (r: Result, label: string) => assert.ok(!r.isError, `${label} failed: ${text(r)}`);

const { tools } = await client.listTools();
assert.deepEqual(
  tools.map((t) => t.name).sort(),
  [
    "mytodoease_complete_task",
    "mytodoease_completion_history",
    "mytodoease_create_label",
    "mytodoease_create_project",
    "mytodoease_create_section",
    "mytodoease_create_task",
    "mytodoease_delete_task",
    "mytodoease_get_task",
    "mytodoease_list_projects",
    "mytodoease_list_tasks",
    "mytodoease_reopen_task",
    "mytodoease_update_task"
  ]
);

const stamp = Date.now().toString(36);
const projectName = `Smoke ${stamp}`;
ok(await call("mytodoease_create_project", { name: projectName, color: "teal" }), "create_project");
ok(await call("mytodoease_create_section", { project: projectName, name: "Sprint 1" }), "create_section");

const projects = await call("mytodoease_list_projects", { response_format: "json" });
ok(projects, "list_projects");
const ws = projects.structuredContent as { projects: { name: string; sections: { name: string }[] }[] };
const smokeProject = ws.projects.find((p) => p.name === projectName);
assert.ok(smokeProject && smokeProject.sections.some((s) => s.name === "Sprint 1"), "project with section listed");

const created = await call("mytodoease_create_task", {
  content: `Release Live ${stamp}`,
  project: projectName,
  section: "Sprint 1",
  labels: ["deploy"],
  priority: 1,
  due_date: "2026-10-28",
  recurrence: "biweekly",
  response_format: "json"
});
ok(created, "create_task");
const task = created.structuredContent as { id: string; dueDate: string; recurrence: string; labels: string[]; sectionName: string };
assert.equal(task.recurrence, "biweekly");
assert.equal(task.sectionName, "Sprint 1");
assert.deepEqual(task.labels, ["deploy"]);

const child = await call("mytodoease_create_task", { content: `Smoke child ${stamp}`, project: projectName, parent_task_id: task.id, response_format: "json" });
ok(child, "create sub-task");

const listed = await call("mytodoease_list_tasks", { project: projectName, search: "release" });
ok(listed, "list_tasks");
assert.ok(text(listed).includes(task.id), "list shows the new task id");
assert.ok(text(listed).includes("repeats every 2 weeks"), "list shows the repeat rule");

const got = await call("mytodoease_get_task", { task_id: task.id });
ok(got, "get_task");
assert.ok(text(got).includes(`Smoke child ${stamp}`), "get_task lists the sub-task");

const updated = await call("mytodoease_update_task", { task_id: task.id, due_date: "tomorrow", priority: 2, labels: [], response_format: "json" });
ok(updated, "update_task");
const u = updated.structuredContent as { priority: number; labels: string[]; dueDate: string };
assert.equal(u.priority, 2);
assert.deepEqual(u.labels, []);

const completed = await call("mytodoease_complete_task", { task_id: task.id, response_format: "json" });
ok(completed, "complete_task");
const c = completed.structuredContent as { isCompleted: boolean; dueDate: string };
assert.equal(c.isCompleted, false, "recurring task stays open");
assert.ok(c.dueDate > u.dueDate, "recurring task rolled forward");

const history = await call("mytodoease_completion_history", { project: projectName });
ok(history, "completion_history");
assert.ok(text(history).includes(`Release Live ${stamp}`), "history lists the completion");

ok(await call("mytodoease_reopen_task", { task_id: task.id }), "reopen_task");

const missing = await call("mytodoease_get_task", { task_id: "ffffffffffffffffffffffff" });
assert.equal(missing.isError, true, "unknown id is a tool error");
const badProject = await call("mytodoease_create_task", { content: "x", project: "No such project" });
assert.equal(badProject.isError, true, "unknown project is a tool error");
assert.ok(text(badProject).includes("Existing projects"), "error lists existing projects");
const badDate = await call("mytodoease_create_task", { content: "x", due_date: "next friday" });
assert.equal(badDate.isError, true, "unparseable date is a tool error");

ok(await call("mytodoease_delete_task", { task_id: task.id }), "delete_task");
const gone = await call("mytodoease_get_task", { task_id: task.id });
assert.equal(gone.isError, true, "deleted task is gone");

await client.close();
console.error("Smoke test passed");

# mytodoease-mcp-server

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants read and manage your TodoEase tasks:
list what is due, add and reschedule tasks, complete them, create projects and labels, and review what you finished.

It talks to the TodoEase API on this computer (`http://localhost:5080`). When the desktop app is closed, nothing is
listening, so the server starts the bundled API executable itself (looked up in the installed app folder, or set
`MYTODOEASE_API_EXE`). The API serves the local file, or the user's Firestore data while the desktop app is signed in to
cloud sync, so the assistant always sees the same tasks as the app.

## Build

```bash
npm install
npm run build:mcp
```

The server is `mcp/dist/index.js` (stdio transport); the same command also bundles it into
`desktop/build/mcp/index.mjs`, which the installer ships as `resources/mcp/index.mjs`. Rebuild after pulling changes.

## Connect an assistant

**Shortcut:** in the app open *Settings → AI assistants* and click a copy button. "Copy setup prompt" gives you a
prompt to paste into any AI chat (the assistant registers the server itself); the others copy the exact
`claude mcp add` / `codex mcp add` command or the JSON block for this machine. Installed builds launch the bundled
server through `TodoEase.exe` with `ELECTRON_RUN_AS_NODE=1`, so no Node.js install is needed.

The manual commands below assume a development checkout; replace `C:\Codes\MyTodoEase` with your checkout path.

### Claude Code

```bash
claude mcp add --scope user mytodoease -- node C:\Codes\MyTodoEase\mcp\dist\index.js
```

Then in any session: "what's due today?", "add 'Release Live' to Rehab every 2 weeks from 28 Oct", "mark the dentist task done".
`claude mcp list` shows the connection; `claude mcp remove mytodoease` removes it.

### Claude Desktop

Settings → Developer → Edit Config, then add to `mcpServers`:

```json
{
  "mcpServers": {
    "mytodoease": {
      "command": "node",
      "args": ["C:\\Codes\\MyTodoEase\\mcp\\dist\\index.js"]
    }
  }
}
```

### Codex (OpenAI)

In `~/.codex/config.toml`:

```toml
[mcp_servers.mytodoease]
command = "node"
args = ["C:\\Codes\\MyTodoEase\\mcp\\dist\\index.js"]
```

Or from the CLI: `codex mcp add mytodoease -- node C:\Codes\MyTodoEase\mcp\dist\index.js`.

### Any other MCP client

Launch `node <path>\mcp\dist\index.js` over stdio. Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MYTODOEASE_API_URL` | `http://localhost:5080` | Where the TodoEase API listens |
| `MYTODOEASE_API_EXE` | installed app / repo build | Executable to start when nothing answers at the URL |

## Tools

| Tool | What it does |
| --- | --- |
| `mytodoease_list_projects` | Projects with sections and open-task counts, plus labels (ids included) |
| `mytodoease_list_tasks` | Tasks by view (`today`, `upcoming`, `overdue`, `inbox`, `no_date`, `all`), project, label, search; optional completed tasks; paginated |
| `mytodoease_get_task` | One task with its sub-tasks |
| `mytodoease_create_task` | New task; project/section/labels by name, due date (`today`, `tomorrow`, `yyyy-MM-dd`), time, priority, recurrence, parent |
| `mytodoease_update_task` | Change any subset of fields; empty string clears date/time/section |
| `mytodoease_complete_task` | Complete (recurring tasks roll forward) |
| `mytodoease_reopen_task` | Undo a completion |
| `mytodoease_delete_task` | Delete a task and its sub-tasks |
| `mytodoease_create_project` / `_section` / `_label` | Organise work |
| `mytodoease_completion_history` | What was completed in a date range, optionally per project |

Every tool accepts `response_format: "json"` for structured output; the default is readable Markdown with ids.

## Test

```bash
# a scratch API so the test never touches your real data
MYTODOEASE_DATA_DIR=%TEMP%\mytodoease-smoke ASPNETCORE_URLS=http://localhost:5081 dotnet run --project backend/MyTodoEase.Api
# in another terminal
cd mcp && npm run build && npm run smoke
```

To exercise the bundled copy the way an installed app launches it, set `MCP_COMMAND`, `MCP_ARGS` (JSON array) and
`MCP_ENV` (JSON object), e.g. `MCP_COMMAND=...\release\win-unpacked\TodoEase.exe`,
`MCP_ARGS=["...\\resources\\mcp\\index.mjs"]`, `MCP_ENV={"ELECTRON_RUN_AS_NODE":"1"}`.

`npx @modelcontextprotocol/inspector node dist/index.js` opens an interactive explorer.

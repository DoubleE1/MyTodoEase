#!/usr/bin/env node
/**
 * mytodoease-mcp-server: lets AI assistants read and manage MyTodoEase tasks over stdio.
 * Talks to the local API (http://localhost:5080 by default) and starts it when the desktop app is closed.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { API_URL } from "./api.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerWorkspaceTools } from "./tools/workspace.js";

function createServer(): McpServer {
  const server = new McpServer({ name: "mytodoease-mcp-server", version: "0.1.0" });
  registerWorkspaceTools(server);
  registerTaskTools(server);
  return server;
}

serveStdio(createServer);
console.error(`mytodoease-mcp-server running on stdio (API: ${API_URL})`);

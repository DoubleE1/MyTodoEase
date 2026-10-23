/**
 * Ready-to-paste snippets that connect an AI assistant to the MyTodoEase MCP server, built from the
 * launcher the desktop shell reports (command, arguments, environment).
 */

export interface McpSetup {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const MCP_SERVER_NAME = 'mytodoease';

/** Quote one argument for a Windows/PowerShell or POSIX shell command line. */
const quote = (value: string): string => (/[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);

const envFlags = (setup: McpSetup, flag: string): string =>
  Object.entries(setup.env)
    .map(([key, value]) => `${flag} ${quote(`${key}=${value}`)}`)
    .join(' ');

const launcher = (setup: McpSetup): string => [setup.command, ...setup.args].map(quote).join(' ');

/** `claude mcp add` line for Claude Code (user scope, so every project can use it). */
export function claudeCodeCommand(setup: McpSetup): string {
  const env = envFlags(setup, '-e');
  return `claude mcp add --scope user ${MCP_SERVER_NAME}${env ? ` ${env}` : ''} -- ${launcher(setup)}`;
}

/** `codex mcp add` line for the OpenAI Codex CLI. */
export function codexCommand(setup: McpSetup): string {
  const env = envFlags(setup, '--env');
  return `codex mcp add ${MCP_SERVER_NAME}${env ? ` ${env}` : ''} -- ${launcher(setup)}`;
}

/** The `mcpServers` JSON block understood by Claude Desktop, Cursor, Windsurf and most other clients. */
export function jsonConfig(setup: McpSetup): string {
  const server: Record<string, unknown> = { command: setup.command, args: setup.args };
  if (Object.keys(setup.env).length > 0) server.env = setup.env;
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2);
}

/**
 * A natural-language prompt the user can paste into any AI chat: it carries the config and asks the
 * assistant to register the server itself, then prove the connection works.
 */
export function setupPrompt(setup: McpSetup): string {
  return [
    'Connect to my MyTodoEase todo app through its MCP server so you can read and manage my tasks.',
    'It is a local stdio server (no network, no API key). Register it in your MCP settings with this configuration:',
    '',
    jsonConfig(setup),
    '',
    'Equivalent one-liners:',
    `- Claude Code: ${claudeCodeCommand(setup)}`,
    `- Codex CLI: ${codexCommand(setup)}`,
    '',
    "The server starts the app's background service by itself if the app is closed.",
    'Once connected, call the mytodoease_list_projects tool and tell me which projects I have, then wait for my instructions.',
  ].join('\n');
}

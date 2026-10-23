import { useQuery } from '@tanstack/react-query';
import { Bot, Braces, Check, Copy, Sparkles, Terminal } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { claudeCodeCommand, codexCommand, jsonConfig, setupPrompt, type McpSetup } from '../lib/mcpSetup';
import { showToast } from '../lib/toast';

type Snippet = 'prompt' | 'claude' | 'codex' | 'json';

interface SnippetDef {
  id: Snippet;
  label: string;
  hint: string;
  icon: ReactNode;
  build: (setup: McpSetup) => string;
}

const SNIPPETS: SnippetDef[] = [
  {
    id: 'prompt',
    label: 'Copy setup prompt',
    hint: 'Paste into any AI chat; the assistant registers the connection itself',
    icon: <Sparkles size={14} />,
    build: setupPrompt,
  },
  { id: 'claude', label: 'Claude Code', hint: 'claude mcp add … command', icon: <Terminal size={14} />, build: claudeCodeCommand },
  { id: 'codex', label: 'Codex CLI', hint: 'codex mcp add … command', icon: <Terminal size={14} />, build: codexCommand },
  { id: 'json', label: 'JSON config', hint: 'Claude Desktop, Cursor, Windsurf', icon: <Braces size={14} />, build: jsonConfig },
];

/** Copy via the Electron clipboard when available (works without window focus), else the browser API. */
async function copyToClipboard(text: string): Promise<void> {
  if (window.mytodoease?.copyText) {
    await window.mytodoease.copyText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

/** Settings block that hands out ready-to-paste MCP setup snippets, Figma-style. */
export function McpSection() {
  const desktop = window.mytodoease;
  const canQuery = Boolean(desktop?.getMcpSetup);
  const setup = useQuery({
    queryKey: ['mcp-setup'],
    queryFn: () => desktop!.getMcpSetup!(),
    enabled: canQuery,
    staleTime: Infinity,
  });
  const [copied, setCopied] = useState<Snippet | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (snippet: SnippetDef) => {
    if (!setup.data) return;
    try {
      await copyToClipboard(snippet.build(setup.data));
      setCopied(snippet.id);
      showToast(`${snippet.label} copied. Paste it into your AI assistant.`);
    } catch {
      showToast('Could not copy to the clipboard.', 'error');
    }
  };

  const ready = setup.data?.available === true;
  const launcher = setup.data ? [setup.data.command, ...setup.data.args].join(' ') : '';

  return (
    <section className="settings-section">
      <h3>AI assistants</h3>
      <p className="settings-help">
        Let Claude, Codex, Cursor or any MCP-capable assistant read and manage your tasks. Copy a snippet and
        paste it into the assistant; the <b>setup prompt</b> lets the AI register the connection itself.
        Everything stays on this computer.
      </p>
      {!canQuery ? (
        <p className="settings-help">Open the desktop app to copy the setup for this machine.</p>
      ) : setup.data && !ready ? (
        <p className="settings-help">
          The MCP server files were not found next to the app. Reinstall MyTodoEase, or in a development checkout
          run <code>npm run build:mcp</code>.
        </p>
      ) : (
        <>
          {setup.data && (
            <p className="settings-path mcp-launcher" title={launcher}>
              <Bot size={12} />
              <span>{launcher}</span>
            </p>
          )}
          <div className="settings-actions">
            {SNIPPETS.map((snippet) => {
              const isCopied = copied === snippet.id;
              return (
                <button
                  key={snippet.id}
                  type="button"
                  className={`btn ${snippet.id === 'prompt' ? 'btn-primary' : ''}`}
                  title={snippet.hint}
                  disabled={!ready}
                  onClick={() => void copy(snippet)}
                >
                  {isCopied ? <Check size={14} /> : snippet.id === 'prompt' ? snippet.icon : <Copy size={14} />}
                  <span>{isCopied ? 'Copied' : snippet.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

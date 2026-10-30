import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CalendarDays, Check, Database, Download, Info, Keyboard, Monitor, Moon, Palette, Pipette, Search, Sun, Upload, UserRound } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { IS_WEB_APP } from '../api/backend';
import { api, ApiError } from '../api/client';
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../lib/accent';
import type { ThemePreference } from '../lib/theme';
import { useReduceMotionSetting } from '../lib/motion';
import { setShowInsightsCard, useShowInsightsCard } from '../lib/insightsCard';
import { showToast } from '../lib/toast';
import type { ConfirmOptions } from './Dialogs';
import { Modal } from './Dialogs';
import { CalendarSyncSection } from './CalendarSyncSection';
import { CloudAccountSection } from './CloudAccountSection';
import { McpSection } from './McpSection';
import { ShortcutsPanel } from './KeyboardShortcuts';
import { useCloudUser } from './SessionGate';
import { AboutSection } from './AboutSection';

const THEMES: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={15} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={15} /> },
  { value: 'system', label: 'System', icon: <Monitor size={15} /> },
];

type SettingsTab = 'appearance' | 'shortcuts' | 'account' | 'calendar' | 'ai' | 'data' | 'about';

/** The nav, grouped like a desktop app's preferences. `keywords` feed the search box at the top of the nav. */
const TAB_GROUPS: { title: string; tabs: { id: SettingsTab; label: string; icon: ReactNode; keywords: string }[] }[] = [
  {
    title: 'Preferences',
    tabs: [
      {
        id: 'appearance',
        label: 'Appearance',
        icon: <Palette size={16} />,
        keywords: 'theme light dark system accent color colour motion animation reduce sidebar insights card',
      },
      {
        id: 'shortcuts',
        label: 'Shortcuts',
        icon: <Keyboard size={16} />,
        keywords: 'keyboard hotkey keybind shortcut search quick add settings collapse sidebar',
      },
    ],
  },
  {
    title: 'Account & sync',
    tabs: [
      { id: 'account', label: 'Account', icon: <UserRound size={16} />, keywords: 'sign in google cloud sync log out email' },
      {
        id: 'calendar',
        label: 'Google Calendar',
        icon: <CalendarDays size={16} />,
        keywords: 'calendar events google sync meetings',
      },
      { id: 'ai', label: 'AI assistants', icon: <Bot size={16} />, keywords: 'mcp claude ai assistant chatgpt cursor' },
    ],
  },
  {
    title: 'App',
    tabs: [
      { id: 'data', label: 'Data', icon: <Database size={16} />, keywords: 'backup export import restore storage file' },
      { id: 'about', label: 'About', icon: <Info size={16} />, keywords: 'version update release about' },
    ],
  },
];

function backupFileName() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `mytodoease-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/** Save text through the Electron save dialog when available, else as a browser download. */
async function saveText(name: string, content: string): Promise<'saved' | 'cancelled'> {
  const desktop = window.mytodoease;
  if (desktop?.saveTextFile) {
    const savedPath = await desktop.saveTextFile(name, content);
    return savedPath ? 'saved' : 'cancelled';
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}

export function SettingsDialog({
  onClose,
  themePreference,
  onSetTheme,
  accent,
  onSetAccent,
  confirm,
}: {
  onClose: () => void;
  themePreference: ThemePreference;
  onSetTheme: (theme: ThemePreference) => void;
  /** Current accent color as #rrggbb. */
  accent: string;
  onSetAccent: (hex: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}) {
  const isPreset = ACCENT_PRESETS.some((p) => p.hex === accent);
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 60_000 });
  const cloudUser = useCloudUser();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [tab, setTab] = useState<SettingsTab>('appearance');
  const [navQuery, setNavQuery] = useState('');
  const q = navQuery.trim().toLowerCase();
  const shownGroups = TAB_GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((t) => !q || `${t.label} ${t.keywords}`.toLowerCase().includes(q)),
  })).filter((g) => g.tabs.length > 0);
  const firstMatch = shownGroups[0]?.tabs[0]?.id;
  // While searching, show the best match unless the current page still matches.
  const activeTab = q && firstMatch && !shownGroups.some((g) => g.tabs.some((t) => t.id === tab)) ? firstMatch : tab;

  const exportBackup = async () => {
    setBusy('export');
    try {
      const doc = await api.backup.export();
      const result = await saveText(backupFileName(), JSON.stringify(doc, null, 2));
      if (result === 'saved') {
        showToast(`Backup saved: ${doc.tasks.length} tasks, ${doc.projects.length} projects.`);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Export failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const importBackup = async (file: File) => {
    setBusy('import');
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error('That file is not valid JSON.');
      }
      const doc = parsed as { app?: unknown; tasks?: unknown[]; projects?: unknown[]; exportedAt?: string };
      if (doc?.app !== 'MyTodoEase') throw new Error('That file is not a TodoEase backup.');

      const exported = doc.exportedAt ? new Date(doc.exportedAt).toLocaleString() : 'unknown date';
      const ok = await confirm({
        title: 'Replace all data?',
        message:
          `This will delete everything currently in TodoEase and load the backup from ${exported} ` +
          `(${doc.projects?.length ?? 0} projects, ${doc.tasks?.length ?? 0} tasks). This cannot be undone.`,
        confirmLabel: 'Replace and import',
      });
      if (!ok) return;

      const result = await api.backup.import(parsed);
      await queryClient.invalidateQueries();
      showToast(`Imported ${result.tasks} tasks, ${result.projects} projects, ${result.labels} labels.`);
      onClose();
    } catch (error) {
      const message = error instanceof ApiError || error instanceof Error ? error.message : 'Import failed.';
      showToast(message, 'error');
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Modal title="Settings" onClose={onClose} className="modal-settings">
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          <label className="settings-search">
            <Search size={14} aria-hidden="true" />
            <input
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search settings"
            />
          </label>
          {shownGroups.length === 0 && <p className="settings-nav-empty muted small">No settings match.</p>}
          {shownGroups.map((group) => (
            <div key={group.title} className="settings-nav-group" role="tablist" aria-label={group.title}>
              <div className="settings-nav-heading">{group.title}</div>
              {group.tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.id}
                  className={`settings-tab ${activeTab === t.id ? 'is-active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-pane" role="tabpanel">
        {activeTab === 'appearance' && (
        <section className="settings-section">
          <h3>Appearance</h3>
          <div className="settings-group">
            <SettingRow title="Theme" description="Light, dark, or follow your computer's setting.">
              <div className="segmented" role="radiogroup" aria-label="Theme">
                {THEMES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={themePreference === t.value}
                    className={`segmented-option ${themePreference === t.value ? 'is-selected' : ''}`}
                    onClick={() => onSetTheme(t.value)}
                  >
                    {t.icon}
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow
              title="Accent color"
              description="Buttons, highlights and the selected page."
              stacked
              extra={
                accent !== DEFAULT_ACCENT && (
                  <button type="button" className="link-btn" onClick={() => onSetAccent(DEFAULT_ACCENT)}>
                    Reset to default
                  </button>
                )
              }
            >
              <div className="color-grid accent-grid" role="radiogroup" aria-label="Accent color">
                {ACCENT_PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    role="radio"
                    aria-checked={accent === p.hex}
                    aria-label={p.label}
                    data-tooltip={p.label}
                    className={`color-swatch ${accent === p.hex ? 'is-selected' : ''}`}
                    style={{ background: p.hex }}
                    onClick={() => onSetAccent(p.hex)}
                  >
                    {accent === p.hex && <Check size={14} />}
                  </button>
                ))}
                <label
                  className={`color-swatch color-swatch-custom ${isPreset ? '' : 'is-selected'}`}
                  data-tooltip="Custom color"
                  style={isPreset ? undefined : { background: accent }}
                >
                  <Pipette size={14} />
                  <input
                    type="color"
                    value={accent}
                    aria-label="Custom accent color"
                    onChange={(event) => onSetAccent(event.target.value)}
                  />
                </label>
              </div>
            </SettingRow>
          </div>

          <h3>Motion</h3>
          <div className="settings-group">
            <ReduceMotionToggle />
          </div>

          <h3>Sidebar</h3>
          <div className="settings-group">
            <InsightsCardToggle />
          </div>
        </section>
        )}

        {activeTab === 'shortcuts' && (
          <section className="settings-section">
            <h3>Shortcuts</h3>
            <ShortcutsPanel />
          </section>
        )}
        {activeTab === 'account' && <CloudAccountSection confirm={confirm} />}
        {activeTab === 'calendar' && <CalendarSyncSection confirm={confirm} />}
        {activeTab === 'ai' && <McpSection />}
        {activeTab === 'about' && <AboutSection />}

        {activeTab === 'data' && (
        <section className="settings-section">
          <h3>Data</h3>
          <p className="settings-help">
            {cloudUser
              ? `Your tasks are stored in the cloud under ${cloudUser.email} and synced to every device signed in with that account. ` +
                'Export a backup to keep a copy; importing a backup replaces everything in the cloud.'
              : IS_WEB_APP
                ? 'Export a backup to keep a copy; importing a backup replaces everything currently here.'
                : 'Your tasks are stored only on this computer. Export a backup to keep a copy or move to another PC; ' +
                  'importing a backup replaces everything currently here. To have them follow you across devices, sign in under Account.'}
          </p>
          {health.data?.storage && (
            <p className="settings-path" data-tooltip={health.data.storage}>
              {health.data.storage}
            </p>
          )}
          <div className="settings-actions">
            <button type="button" className="btn" onClick={() => void exportBackup()} disabled={busy !== null}>
              <Download size={14} />
              <span>{busy === 'export' ? 'Exporting…' : 'Export backup…'}</span>
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => fileInput.current?.click()}
              disabled={busy !== null}
            >
              <Upload size={14} />
              <span>{busy === 'import' ? 'Importing…' : 'Import backup…'}</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBackup(file);
              }}
            />
          </div>
        </section>
        )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * One setting: title and description on the left, its control on the right (or underneath when `stacked`,
 * for wide controls like the colour swatches). Rows sit in a `.settings-group` card, divided by lines.
 */
function SettingRow({
  title,
  description,
  children,
  stacked = false,
  extra,
  labelId,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  stacked?: boolean;
  /** Small trailing content under the description, e.g. a reset link. */
  extra?: ReactNode;
  /** Id for the title so a switch can point aria-labelledby at it. */
  labelId?: string;
}) {
  return (
    <div className={`setting-row ${stacked ? 'is-stacked' : ''}`}>
      <div className="setting-text">
        <span className="setting-title" id={labelId}>
          {title}
        </span>
        {description && (
          <span className="setting-desc" id={labelId ? `${labelId}-desc` : undefined}>
            {description}
          </span>
        )}
        {extra}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function SwitchRow({
  id,
  title,
  description,
  on,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <SettingRow title={title} description={description} labelId={id}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={id}
        aria-describedby={`${id}-desc`}
        className={`switch ${on ? 'is-on' : ''}`}
        onClick={() => onChange(!on)}
      >
        <span className="switch-thumb" />
      </button>
    </SettingRow>
  );
}

/** Settings > Appearance: show or hide the Insights card at the top of the sidebar. */
function InsightsCardToggle() {
  const show = useShowInsightsCard();
  return (
    <SwitchRow
      id="insights-card"
      title="Show Insights card"
      description="Today's progress ring, this week's chart and your streak. When hidden, Insights becomes a normal item in the sidebar list."
      on={show}
      onChange={setShowInsightsCard}
    />
  );
}

/** Settings > Appearance: turn off animations in the app (the OS "reduce motion" setting is always honoured too). */
function ReduceMotionToggle() {
  const [reduce, setReduce] = useReduceMotionSetting();
  return (
    <SwitchRow
      id="reduce-motion"
      title="Reduce motion"
      description="Turns off animations such as list movement, pop-ups and the completion effect."
      on={reduce}
      onChange={setReduce}
    />
  );
}

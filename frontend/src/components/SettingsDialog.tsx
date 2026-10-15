import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Monitor, Moon, Sun, Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { ThemePreference } from '../lib/theme';
import { showToast } from '../lib/toast';
import type { ConfirmOptions } from './Dialogs';
import { Modal } from './Dialogs';

const THEMES: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={15} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={15} /> },
  { value: 'system', label: 'System', icon: <Monitor size={15} /> },
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
  confirm,
}: {
  onClose: () => void;
  themePreference: ThemePreference;
  onSetTheme: (theme: ThemePreference) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}) {
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 60_000 });
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

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
      if (doc?.app !== 'MyTodoEase') throw new Error('That file is not a MyTodoEase backup.');

      const exported = doc.exportedAt ? new Date(doc.exportedAt).toLocaleString() : 'unknown date';
      const ok = await confirm({
        title: 'Replace all data?',
        message:
          `This will delete everything currently in MyTodoEase and load the backup from ${exported} ` +
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
    <Modal title="Settings" onClose={onClose}>
      <div className="settings">
        <section className="settings-section">
          <h3>Appearance</h3>
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
        </section>

        <section className="settings-section">
          <h3>Data</h3>
          <p className="settings-help">
            Your tasks are stored only on this computer. Export a backup to keep a copy or move to another PC;
            importing a backup replaces everything currently here.
          </p>
          {health.data?.storage && (
            <p className="settings-path" title={health.data.storage}>
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
      </div>
    </Modal>
  );
}

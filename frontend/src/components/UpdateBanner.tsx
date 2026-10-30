import { Download, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { useUpdateState } from '../lib/updates';

/** "Not now" lasts until the next launch, shared by the sidebar card and the mini-window banner. */
let dismissedVersion: string | null = null;

function useRestart() {
  const { state, install } = useUpdateState();
  const [dismissed, setDismissed] = useState(dismissedVersion);
  const [restarting, setRestarting] = useState(false);
  const restart = async () => {
    setRestarting(true);
    const started = await install();
    if (!started) setRestarting(false);
  };
  const dismiss = () => {
    dismissedVersion = state?.version ?? '';
    setDismissed(dismissedVersion);
  };
  const hidden = !state || dismissed === (state.version ?? '');
  return { state, hidden, restarting, restart, dismiss };
}

/**
 * Small bottom banner for the mini window (it has no sidebar), shown once an update has been downloaded.
 * Nothing installs until the user clicks "Restart to update".
 */
export function UpdateBanner() {
  const { state, hidden, restarting, restart, dismiss } = useRestart();
  if (hidden || !state || state.status !== 'ready') return null;

  return (
    <div className="update-banner" role="status">
      <RefreshCw size={16} className="update-banner-icon" aria-hidden="true" />
      <span className="update-banner-text">
        <strong>TodoEase {state.version}</strong> is ready to install.
      </span>
      <button type="button" className="btn btn-primary" onClick={() => void restart()} disabled={restarting}>
        {restarting ? 'Restarting…' : 'Restart to update'}
      </button>
      <button type="button" className="icon-btn" onClick={dismiss} aria-label="Not now" data-tooltip="Not now">
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * Update card at the bottom of the sidebar, above the profile: shows the download while it runs, then
 * "Restart to update". In the icon rail it is a single button with a dot. Desktop app only.
 */
export function SidebarUpdate({ rail }: { rail: boolean }) {
  const { state, hidden, restarting, restart, dismiss } = useRestart();
  if (hidden || !state || (state.status !== 'ready' && state.status !== 'downloading')) return null;
  const ready = state.status === 'ready';
  const version = state.version ? `TodoEase ${state.version}` : 'A new version';

  if (rail) {
    return (
      <button
        type="button"
        className="sidebar-update-dot"
        onClick={() => ready && void restart()}
        disabled={!ready || restarting}
        data-tooltip={ready ? `${version} is ready. Restart to update` : `Downloading ${version}… ${state.progress}%`}
        data-tooltip-side="right"
        aria-label={ready ? 'Restart to update' : `Downloading update, ${state.progress}%`}
      >
        <Download size={16} />
      </button>
    );
  }

  return (
    <div className="sidebar-update" role="status">
      <div className="sidebar-update-head">
        <Download size={14} className="sidebar-update-icon" aria-hidden="true" />
        <span className="sidebar-update-title">{ready ? 'Update available' : 'Downloading update…'}</span>
        {ready && (
          <button type="button" className="icon-btn" onClick={dismiss} aria-label="Not now" data-tooltip="Not now">
            <X size={13} />
          </button>
        )}
      </div>
      <p className="sidebar-update-text">
        {ready ? `${version} is downloaded.` : `${version}, ${state.progress}%`}
      </p>
      {ready ? (
        <button type="button" className="btn btn-primary sidebar-update-btn" onClick={() => void restart()} disabled={restarting}>
          {restarting ? 'Restarting…' : 'Restart to update'}
        </button>
      ) : (
        <div className="sidebar-update-progress" aria-hidden="true">
          <span style={{ width: `${state.progress ?? 0}%` }} />
        </div>
      )}
    </div>
  );
}

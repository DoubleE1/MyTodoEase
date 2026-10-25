import { RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { useUpdateState } from '../lib/updates';

/**
 * Small bottom banner shown by the desktop app once an update has been downloaded. Nothing installs until
 * the user clicks "Restart to update"; dismissing hides it for that version until the next launch.
 */
export function UpdateBanner() {
  const { state, install } = useUpdateState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  if (!state || state.status !== 'ready' || dismissed === (state.version ?? '')) return null;

  const restart = async () => {
    setRestarting(true);
    const started = await install();
    if (!started) setRestarting(false);
  };

  return (
    <div className="update-banner" role="status">
      <RefreshCw size={16} className="update-banner-icon" aria-hidden="true" />
      <span className="update-banner-text">
        <strong>TodoEase {state.version}</strong> is ready to install.
      </span>
      <button type="button" className="btn btn-primary" onClick={() => void restart()} disabled={restarting}>
        {restarting ? 'Restarting…' : 'Restart to update'}
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setDismissed(state.version ?? '')}
        aria-label="Not now"
        title="Not now"
      >
        <X size={14} />
      </button>
    </div>
  );
}

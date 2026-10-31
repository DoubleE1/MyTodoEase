import logoUrl from '../assets/logo.png';

/**
 * TodoEase mark: the provided artwork (deep-space tile with a neon blue-to-pink orbit swoosh and
 * a four-point star), cropped to the tile with transparent rounded corners. src/assets/logo.png is
 * the in-app copy; public/logo.png (favicon) and desktop/build/icon.* (window and installer) come
 * from the same crop.
 */
export function Logo({ size = 20, title = 'TodoEase' }: { size?: number; title?: string }) {
  return <img src={logoUrl} width={size} height={size} alt={title} className="logo" draggable={false} />;
}

/** Logo plus the name, with "Ease" in the brand gradient. */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="wordmark">
      <Logo size={size} />
      <span className="wordmark-text">
        Todo<strong>Ease</strong>
      </span>
    </span>
  );
}

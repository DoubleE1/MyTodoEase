/**
 * MyTodoEase mark: a glassy tile with the brand gradient (blue → violet → pink) and three
 * list rows drawn as sparkle bullets with comet trails. Inline SVG so it scales crisply.
 * The same artwork lives in public/logo.svg and desktop/build/icon.* for favicon and installer.
 */
const SPARKLE =
  'M0 -8 C0.9 -2.6, 2.6 -0.9, 8 0 C2.6 0.9, 0.9 2.6, 0 8 C-0.9 2.6, -2.6 0.9, -8 0 C-2.6 -0.9, -0.9 -2.6, 0 -8 Z';
const ROWS = [19, 32, 45];

export function Logo({ size = 20, title = 'MyTodoEase' }: { size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={title} className="logo">
      <defs>
        <linearGradient id="logo-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3f8cff" />
          <stop offset="0.5" stopColor="#7b4dff" />
          <stop offset="1" stopColor="#ff5fa8" />
        </linearGradient>
        <radialGradient id="logo-glass" cx="0.25" cy="0.15" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="logo-trail" gradientUnits="userSpaceOnUse" x1="22" y1="0" x2="53" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#logo-tile)" />
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#logo-glass)" />
      <rect x="2.5" y="2.5" width="59" height="59" rx="14.5" fill="none" stroke="#fff" strokeOpacity="0.35" />
      <g fill="#fff">
        <circle cx="45" cy="13" r="1.1" opacity="0.9" />
        <circle cx="53" cy="24" r="0.8" opacity="0.7" />
        <circle cx="39" cy="39" r="0.7" opacity="0.6" />
        <circle cx="49" cy="50" r="0.9" opacity="0.75" />
        <circle cx="27" cy="53" r="0.7" opacity="0.6" />
        <circle cx="12" cy="11" r="0.7" opacity="0.5" />
      </g>
      {ROWS.map((y) => (
        <path
          key={`trail-${y}`}
          d={`M22 ${y - 1.6} C34 ${y - 2.6}, 44 ${y - 4}, 53 ${y - 6.5} C44 ${y - 2.2}, 34 ${y + 0.2}, 22 ${y + 1.6} Z`}
          fill="url(#logo-trail)"
        />
      ))}
      <g fill="#fff">
        {ROWS.map((y) => (
          <path key={`star-${y}`} transform={`translate(17 ${y}) scale(0.62)`} d={SPARKLE} />
        ))}
      </g>
    </svg>
  );
}

/** Logo plus the name, with "Ease" in the brand gradient. */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="wordmark">
      <Logo size={size} />
      <span className="wordmark-text">
        MyTodo<strong>Ease</strong>
      </span>
    </span>
  );
}

import { t } from '../i18n';
/**
 * User-chosen accent (primary) color. The stylesheet ships the default violet palette; when the
 * user picks another color we derive the whole family from it (hover/text shades, tinted active
 * background, brand gradient and header halos) and set them as inline CSS variables on <html>.
 * Choosing the default removes them again so the hand-tuned stylesheet values apply.
 */

export const ACCENT_KEY = 'mytodoease.accent';
export const DEFAULT_ACCENT = '#6d5dfc';

export const ACCENT_PRESETS: { hex: string; label: string }[] = [
  { hex: DEFAULT_ACCENT, label: t('Violet (default)') },
  { hex: '#3b82f6', label: t('Blue') },
  { hex: '#0ea5e9', label: t('Sky') },
  { hex: '#0d9488', label: t('Teal') },
  { hex: '#16a34a', label: t('Green') },
  { hex: '#ca8a04', label: t('Gold') },
  { hex: '#ea580c', label: t('Orange') },
  { hex: '#e11d48', label: t('Rose') },
  { hex: '#db2777', label: t('Pink') },
  { hex: '#64748b', label: t('Slate') },
];

export function readStoredAccent(): string {
  try {
    const value = window.localStorage.getItem(ACCENT_KEY);
    return value && isHex(value) ? value.toLowerCase() : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function storeAccent(hex: string) {
  try {
    if (hex === DEFAULT_ACCENT) window.localStorage.removeItem(ACCENT_KEY);
    else window.localStorage.setItem(ACCENT_KEY, hex);
  } catch {
    // Not persisted; fine.
  }
}

export const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

// ---- Color math in OKLCH, so "a bit lighter" means the same thing for teal as for violet. ----

type Oklch = { l: number; c: number; h: number };

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(a, bb);
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

/** OKLCH → #rrggbb, reducing chroma until the color fits in sRGB (keeps hue and lightness honest). */
function oklchToHex(color: Oklch): string {
  let c = color.c;
  let rgb = oklchToLinearRgb({ ...color, c });
  const inGamut = (v: number[]) => v.every((x) => x >= -0.0005 && x <= 1.0005);
  while (!inGamut(rgb) && c > 0.002) {
    c -= 0.004;
    rgb = oklchToLinearRgb({ ...color, c });
  }
  return `#${rgb
    .map((v) => Math.round(clamp(linearToSrgb(clamp(v, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Mix `hex` towards `towards` by `amount` (0..1) in sRGB. */
function mix(hex: string, towards: string, amount: number): string {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(towards.slice(i, i + 2), 16));
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('')}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface AccentPalette {
  accent: string;
  hover: string;
  text: string;
  bgActive: string;
  brand: [string, string, string];
  gradient: string;
  haloA: string;
  haloB: string;
}

export function derivePalette(hex: string, theme: 'light' | 'dark'): AccentPalette {
  const base = hexToOklch(hex);
  const dark = theme === 'dark';
  // Greys keep a touch of chroma so the gradient still reads as a gradient.
  const chroma = Math.max(base.c, 0.03);
  const at = (l: number, c = chroma, h = base.h) => oklchToHex({ l: clamp(l, 0.1, 0.97), c, h });

  // Solid accent: on dark backgrounds lift it so it stays legible as text and borders.
  const accent = dark ? at(clamp(base.l + 0.06, 0.66, 0.8), Math.min(chroma, 0.16)) : hex;
  const hover = dark ? at(clamp(base.l + 0.12, 0.72, 0.86), Math.min(chroma, 0.15)) : at(base.l - 0.06);
  // Text on the page background needs more contrast than a filled button does.
  const text = dark ? at(clamp(base.l + 0.24, 0.78, 0.9), Math.min(chroma, 0.12)) : at(Math.min(base.l, 0.52) - 0.02);
  const bgActive = dark ? mix(accent, '#1f1f1f', 0.74) : mix(hex, '#ffffff', 0.88);

  // Brand trio: a cooler neighbour, the accent itself, a warmer neighbour (blue → violet → pink by default).
  const bc = clamp(chroma, 0.11, 0.19);
  const bl = dark ? 0.72 : 0.66;
  const brand: [string, string, string] = [at(bl, bc, base.h - 32), at(bl, bc, base.h), at(bl + 0.03, bc, base.h + 62)];
  const gradient = `linear-gradient(135deg, ${brand[0]}, ${brand[1]} 55%, ${brand[2]})`;
  const haloA = `linear-gradient(110deg, ${brand[0]} 0%, ${brand[1]} 60%, ${at(bl + 0.02, bc, base.h + 18)} 100%)`;
  const haloB = `linear-gradient(110deg, ${at(bl + 0.02, bc, base.h + 20)} 0%, ${at(bl + 0.03, bc, base.h + 42)} 45%, ${brand[2]} 100%)`;

  return { accent, hover, text, bgActive, brand, gradient, haloA, haloB };
}

const VARIABLES = [
  '--accent',
  '--accent-hover',
  '--accent-text',
  '--bg-active',
  '--brand-1',
  '--brand-2',
  '--brand-3',
  '--accent-gradient',
  '--halo-a',
  '--halo-b',
];

/** Set (or, for the default, clear) the accent family on <html>. */
export function applyAccent(hex: string, theme: 'light' | 'dark') {
  const root = document.documentElement.style;
  if (hex === DEFAULT_ACCENT || !isHex(hex)) {
    for (const name of VARIABLES) root.removeProperty(name);
    return;
  }
  const p = derivePalette(hex, theme);
  root.setProperty('--accent', p.accent);
  root.setProperty('--accent-hover', p.hover);
  root.setProperty('--accent-text', p.text);
  root.setProperty('--bg-active', p.bgActive);
  root.setProperty('--brand-1', p.brand[0]);
  root.setProperty('--brand-2', p.brand[1]);
  root.setProperty('--brand-3', p.brand[2]);
  root.setProperty('--accent-gradient', p.gradient);
  root.setProperty('--halo-a', p.haloA);
  root.setProperty('--halo-b', p.haloB);
}

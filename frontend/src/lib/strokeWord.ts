/**
 * A word as one joined, slanted handwriting stroke, like a signature, for writing it with a moving point of light
 * (components/ChromaTrail.tsx). Each letter is a few hand-placed points in a 1-em box: x from the letter's left
 * edge, y from the top of a capital (0) to the baseline (1); small letters start at the x-height (about 0.45).
 * Letters enter from the one before and leave towards the next, and the whole word is run through one smooth curve,
 * so the pen never lifts.
 */

type Pt = [number, number];
type Letter = { advance: number; points: Pt[] };

/** How far the writing leans right, in em per em of height. */
const SLANT = 0.2;

/** A smooth curve through the given points (Catmull-Rom), so hand-placed points read as a pen stroke. */
function curve(points: Pt[], perSpan = 10): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < perSpan; s++) {
      const t = s / perSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([at(p0[0], p1[0], p2[0], p3[0]), at(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** The round body of o, d and a: in at its top right, anticlockwise round, back up its right side. */
const BOWL: Pt[] = [
  [0.48, 0.5],
  [0.28, 0.45],
  [0.1, 0.62],
  [0.12, 0.88],
  [0.3, 1],
  [0.48, 0.85],
];

const LETTERS: Record<string, Letter> = {
  // The bar first, a quick hook back, then the stem down and out towards the next letter.
  T: {
    advance: 0.72,
    points: [
      [0.02, 0.2],
      [0.2, 0.05],
      [0.5, 0.02],
      [0.85, 0.04],
      [0.62, 0.1],
      [0.45, 0.18],
      [0.4, 0.5],
      [0.38, 0.85],
      [0.48, 1],
      [0.66, 0.92],
    ],
  },
  o: {
    advance: 0.62,
    points: [
      ...BOWL,
      [0.5, 0.6],
      [0.42, 0.47],
      [0.56, 0.5],
      [0.7, 0.5],
    ],
  },
  d: {
    advance: 0.78,
    points: [
      ...BOWL,
      [0.54, 0.55],
      [0.6, 0.2],
      [0.64, 0],
      [0.6, 0.35],
      [0.56, 0.75],
      [0.6, 0.98],
      [0.76, 0.9],
    ],
  },
  // Like a reversed 3: the top curl, a small loop in the middle, the bottom curl.
  E: {
    advance: 0.68,
    points: [
      [0.62, 0.1],
      [0.45, 0],
      [0.22, 0.05],
      [0.16, 0.25],
      [0.36, 0.44],
      [0.18, 0.5],
      [0.06, 0.7],
      [0.12, 0.94],
      [0.36, 1],
      [0.6, 0.9],
    ],
  },
  a: {
    advance: 0.72,
    points: [
      ...BOWL,
      [0.54, 0.5],
      [0.52, 0.8],
      [0.58, 0.98],
      [0.74, 0.9],
    ],
  },
  s: {
    advance: 0.6,
    points: [
      [0.12, 0.62],
      [0.3, 0.44],
      [0.42, 0.66],
      [0.42, 0.88],
      [0.26, 1],
      [0.1, 0.94],
      [0.32, 0.97],
      [0.56, 0.88],
    ],
  },
  // A loop, and a tail that flicks up and away to end the signature.
  e: {
    advance: 0.9,
    points: [
      [0.08, 0.8],
      [0.36, 0.7],
      [0.48, 0.56],
      [0.36, 0.45],
      [0.16, 0.55],
      [0.1, 0.8],
      [0.26, 0.99],
      [0.5, 0.96],
      [0.72, 0.84],
      [0.95, 0.7],
    ],
  },
};

/** Total width of `word` in em, slant included (letters without a shape are skipped). */
export function wordWidth(word: string): number {
  return [...word].reduce((w, ch) => w + (LETTERS[ch]?.advance ?? 0), 0) + SLANT;
}

/**
 * The strokes for `word`, in px: letters `size` px tall, starting at (left, top). The letters are joined into one
 * stroke; letters this module has no shape for are skipped.
 */
export function wordStrokes(word: string, left: number, top: number, size: number): { x: number; y: number }[][] {
  const points: Pt[] = [];
  let x = 0;
  for (const ch of word) {
    const letter = LETTERS[ch];
    if (!letter) continue;
    for (const [u, v] of letter.points) points.push([x + u + (1 - v) * SLANT, v]);
    x += letter.advance;
  }
  if (points.length < 2) return [];
  return [curve(points).map(([u, v]) => ({ x: left + u * size, y: top + v * size }))];
}

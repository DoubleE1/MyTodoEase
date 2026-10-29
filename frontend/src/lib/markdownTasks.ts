/**
 * Flip the checklist box on one line of a Markdown text (`- [ ] x` <-> `- [x] x`), leaving everything else,
 * including line endings, untouched. `line` is 1-based, as in Markdown source positions. Returns the text
 * unchanged when that line holds no checklist box.
 */
export function toggleTaskOnLine(text: string, line: number): string {
  const lines = text.split('\n');
  const index = line - 1;
  if (index < 0 || index >= lines.length) return text;
  const current = lines[index];
  const match = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/.exec(current);
  if (!match) return text;
  const flipped = match[2] === ' ' ? 'x' : ' ';
  lines[index] = match[1] + flipped + match[3] + current.slice(match[0].length);
  return lines.join('\n');
}

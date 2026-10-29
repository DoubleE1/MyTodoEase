/** First line of a Markdown text as plain words, for one-line previews in task rows. */
export function markdownPreview(text: string): string {
  const firstLine = text.split('\n').find((line) => line.trim() !== '') ?? '';
  return firstLine
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$)/g, '$1$2')
    .trim();
}

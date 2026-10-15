import type { Priority } from '../api/types';

/** Named colors for projects and labels. Names are what gets stored; hex is presentation only. */
export const COLORS: { name: string; hex: string; label: string }[] = [
  { name: 'berry_red', hex: '#b8255f', label: 'Berry red' },
  { name: 'red', hex: '#db4035', label: 'Red' },
  { name: 'orange', hex: '#ff9933', label: 'Orange' },
  { name: 'yellow', hex: '#fad000', label: 'Yellow' },
  { name: 'olive_green', hex: '#afb83b', label: 'Olive green' },
  { name: 'green', hex: '#299438', label: 'Green' },
  { name: 'mint_green', hex: '#6accbc', label: 'Mint green' },
  { name: 'teal', hex: '#158fad', label: 'Teal' },
  { name: 'sky_blue', hex: '#14aaf5', label: 'Sky blue' },
  { name: 'blue', hex: '#4073ff', label: 'Blue' },
  { name: 'grape', hex: '#884dff', label: 'Grape' },
  { name: 'violet', hex: '#af38eb', label: 'Violet' },
  { name: 'magenta', hex: '#e05194', label: 'Magenta' },
  { name: 'salmon', hex: '#ff8d85', label: 'Salmon' },
  { name: 'charcoal', hex: '#808080', label: 'Charcoal' },
  { name: 'grey', hex: '#b8b8b8', label: 'Grey' },
  { name: 'taupe', hex: '#ccac93', label: 'Taupe' },
];

export function colorHex(name: string | undefined): string {
  return COLORS.find((c) => c.name === name)?.hex ?? '#b8b8b8';
}

export const PRIORITY_META: Record<Priority, { label: string; hex: string }> = {
  1: { label: 'Priority 1', hex: '#d1453b' },
  2: { label: 'Priority 2', hex: '#eb8909' },
  3: { label: 'Priority 3', hex: '#246fe0' },
  4: { label: 'Priority 4', hex: '#808080' },
};

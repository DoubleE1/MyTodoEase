import type { Priority } from '../api/types';
import { t } from '../i18n';

/** Named colors for projects and labels. Names are what gets stored; hex is presentation only. */
export const COLORS: { name: string; hex: string; label: string }[] = [
  { name: 'berry_red', hex: '#b8255f', label: t('Berry red') },
  { name: 'red', hex: '#db4035', label: t('Red') },
  { name: 'orange', hex: '#ff9933', label: t('Orange') },
  { name: 'yellow', hex: '#fad000', label: t('Yellow') },
  { name: 'olive_green', hex: '#afb83b', label: t('Olive green') },
  { name: 'green', hex: '#299438', label: t('Green') },
  { name: 'mint_green', hex: '#6accbc', label: t('Mint green') },
  { name: 'teal', hex: '#158fad', label: t('Teal') },
  { name: 'sky_blue', hex: '#14aaf5', label: t('Sky blue') },
  { name: 'blue', hex: '#4073ff', label: t('Blue') },
  { name: 'grape', hex: '#884dff', label: t('Grape') },
  { name: 'violet', hex: '#af38eb', label: t('Violet') },
  { name: 'magenta', hex: '#e05194', label: t('Magenta') },
  { name: 'salmon', hex: '#ff8d85', label: t('Salmon') },
  { name: 'charcoal', hex: '#808080', label: t('Charcoal') },
  { name: 'grey', hex: '#b8b8b8', label: t('Grey') },
  { name: 'taupe', hex: '#ccac93', label: t('Taupe') },
];

export function colorHex(name: string | undefined): string {
  return COLORS.find((c) => c.name === name)?.hex ?? '#b8b8b8';
}

export const PRIORITY_META: Record<Priority, { label: string; hex: string }> = {
  1: { label: t('Priority {n}', { n: 1 }), hex: '#d1453b' },
  2: { label: t('Priority {n}', { n: 2 }), hex: '#eb8909' },
  3: { label: t('Priority {n}', { n: 3 }), hex: '#246fe0' },
  4: { label: t('Priority {n}', { n: 4 }), hex: '#808080' },
};

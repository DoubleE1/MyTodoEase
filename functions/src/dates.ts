/**
 * Calendar-date helpers for a user's IANA time zone. Tasks carry plain local dates (yyyy-MM-dd) and times
 * (HH:mm), so Google's timed events are mapped into that same local frame before they are stored.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isDateStr = (value: unknown): value is string => typeof value === 'string' && DATE_RE.test(value);
export const isTimeStr = (value: unknown): value is string => typeof value === 'string' && TIME_RE.test(value);

/** True when the zone is one Intl knows; anything else falls back to UTC. */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** The local calendar date and wall-clock time of an instant in the given zone. */
export function localParts(instant: Date, zone: string): { date: string; time: string } {
  const parts = Object.fromEntries(formatter(zone).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
  };
}

export const todayIn = (zone: string): string => localParts(new Date(), zone).date;

/** yyyy-MM-dd plus n days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

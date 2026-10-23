/**
 * Ids are 24 hex characters (the ObjectId shape the desktop API generates and validates), so backups
 * move between the web app and the desktop app without rewriting references.
 */
export const ID_PATTERN = /^[0-9a-f]{24}$/;

export const isValidId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value);

export function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  // Leading 4 bytes carry the time, like ObjectId, so ids created in sequence sort by creation.
  const seconds = Math.floor(Date.now() / 1000);
  bytes[0] = (seconds >>> 24) & 0xff;
  bytes[1] = (seconds >>> 16) & 0xff;
  bytes[2] = (seconds >>> 8) & 0xff;
  bytes[3] = seconds & 0xff;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

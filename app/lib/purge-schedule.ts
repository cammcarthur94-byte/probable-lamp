export const PURGE_RETENTION_DAYS = 30;
export const PURGE_MAX_DELAY_MS = 6 * 24 * 60 * 60 * 1000;

export function nextPurgeSchedule(purgeAt: Date, now: Date) {
  return new Date(Math.min(purgeAt.getTime(), now.getTime() + PURGE_MAX_DELAY_MS));
}

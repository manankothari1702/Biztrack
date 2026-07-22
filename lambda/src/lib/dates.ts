/**
 * Date-only helpers for expiries.
 *
 * Expiries are calendar dates (`YYYY-MM-DD`) — a batch expires on a day, not at
 * an instant. Because ISO dates sort lexicographically, they are COMPARED as
 * plain strings; these helpers only do the arithmetic, and never let a host
 * timezone shift a day boundary.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Today in the user's timezone, as `YYYY-MM-DD`.
 *
 * `new Date().toISOString().slice(0,10)` is UTC and is simply wrong for
 * Asia/Kolkata (+05:30) for five and a half hours of every day — stock would
 * read as expired a day early, or a day late. `en-CA` formats as `YYYY-MM-DD`.
 */
export const todayIso = (timeZone: string = DEFAULT_TIMEZONE): string =>
    new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

/**
 * Shift a date-only ISO string by N calendar days, staying date-only.
 *
 * Built from explicit Y/M/D components in UTC and read back with
 * `toISOString().slice(0,10)`, so the host timezone never enters the
 * calculation. `Date.UTC` normalizes overflow, so month, year and leap-day
 * boundaries fall out for free.
 */
export const addDaysIso = (date: string, days: number): string => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** True for a well-formed, real calendar date in `YYYY-MM-DD` form. */
export const isIsoDate = (value: unknown): value is string => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    // Rejects 2026-02-30 and friends: Date.UTC rolls them over, so a round-trip
    // through it only returns the same string for dates that actually exist.
    const [y, m, d] = value.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value;
};

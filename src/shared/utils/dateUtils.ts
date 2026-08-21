import { format, isValid } from 'date-fns';
import { logger } from './logger';

/**
 * Normalizes any date input to a UTC ISO string (Start of Day).
 * Use this for storing dates in the database.
 * @param date - Date object or date string
 * @returns ISO string (e.g. "2024-02-05T00:00:00.000Z")
 */
export const toUtcIso = (date: Date | string): string => {
    if (!date) return '';
    try {
        const d = typeof date === 'string' ? new Date(date) : date;
        if (!isValid(d)) return '';
        // Create UTC date at midnight
        return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
    } catch {
        logger.error('Invalid date provided to toUtcIso:', date);
        return '';
    }
};

/**
 * Extracts YYYY-MM-DD for HTML input fields from a stored ISO string.
 * This converts the stored UTC date to the corresponding local date string
 * relative to the user's current timezone.
 * @param isoString - stored ISO string (e.g. "2024-02-05T00:00:00.000Z")
 * @returns string "YYYY-MM-DD" or empty string if invalid
 */
export const toInputDate = (isoString: string): string => {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (!isValid(date)) return '';

        // Return local YYYY-MM-DD
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        logger.error('Error in toInputDate:', e);
        return '';
    }
};

/**
 * Converts YYYY-MM-DD from an input field back to a UTC ISO string (Start of Day).
 * Handles the local -> UTC conversion safely.
 * @param dateStr - "YYYY-MM-DD" from input
 * @returns ISO string (e.g. "2024-02-05T00:00:00.000Z")
 */
export const fromInputDate = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
        // Construct a local date at midnight
        const local = new Date(`${dateStr}T00:00:00`);
        if (!isValid(local)) return '';

        // Convert the local components to a UTC date
        return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate())).toISOString();
    } catch (e) {
        logger.error('Error in fromInputDate:', e);
        return '';
    }
};

/**
 * Formats a date for display in the UI (e.g. "Feb 5, 2024").
 * Renders based on the user's local timezone.
 * @param isoString - UTC ISO string
 * @param formatStr - date-fns format string (default 'MMM d, yyyy')
 * @returns Formatted date string
 */
export const formatDisplayDate = (isoString: string, formatStr: string = 'MMM d, yyyy'): string => {
    if (!isoString) return 'Invalid Date';
    try {
        const date = new Date(isoString);
        if (!isValid(date)) return 'Invalid Date';
        return format(date, formatStr);
    } catch {
        return 'Invalid Date';
    }
};

/**
 * Checks if two dates refer to the same day (local time comparison).
 * @param iso1
 * @param iso2
 * @returns true if same calendar day
 */
export const isSameDay = (iso1: string, iso2: string): boolean => {
    if (!iso1 || !iso2) return false;
    const d1 = new Date(iso1);
    const d2 = new Date(iso2);
    if (!isValid(d1) || !isValid(d2)) return false;

    return d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate();
};

/**
 * Gets today's date in YYYY-MM-DD format (local time), useful for input defaults.
 */
export const getTodayInput = (): string => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
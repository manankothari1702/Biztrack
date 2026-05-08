/**
 * Normalizes an email address by trimming whitespace and converting to lowercase.
 * This ensures consistent handling of email addresses across the application.
 *
 * @param email - The email address to normalize
 * @returns The normalized email address
 */
export const normalizeEmail = (email: string): string => {
    if (!email) return '';
    return email.trim().toLowerCase();
};
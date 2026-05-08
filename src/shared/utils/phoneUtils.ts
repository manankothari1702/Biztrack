/**
 * Utility functions for phone number handling
 */

/**
 * Generates a WhatsApp deep link/URL from a phone number.
 * Formatting Rules:
 * - Use the client's saved phone number (with country code)
 * - Remove spaces, dashes, brackets, and + before generating the link
 * - Example: +91 96804 94400 -> 919680494400
 * - Returns null if phone number is missing or empty
 *
 * @param phone The raw phone number string
 * @returns The formatted WhatsApp URL (https://wa.me/...) or null
 */
export const getWhatsAppLink = (phone: string | undefined | null): string | null => {
    if (!phone) return null;

    // Remove all non-numeric characters
    const cleanNumber = phone.replace(/\D/g, '');

    if (!cleanNumber) return null;

    return `https://wa.me/${cleanNumber}`;
};
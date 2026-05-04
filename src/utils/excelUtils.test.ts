import { describe, it, expect } from 'vitest';
import { normalizeMobile, validateClientRow } from './excelUtils';
import type { Client } from '../types';

// ---------------------------------------------------------------------------
// normalizeMobile
// ---------------------------------------------------------------------------

describe('normalizeMobile', () => {
    it('strips non-digit characters', () => {
        expect(normalizeMobile('+91 98765-43210')).toBe('919876543210');
    });

    it('handles numeric input', () => {
        expect(normalizeMobile(9876543210)).toBe('9876543210');
    });

    it('returns empty string for empty input', () => {
        expect(normalizeMobile('')).toBe('');
    });
});

// ---------------------------------------------------------------------------
// Helper: build a minimal valid row
// ---------------------------------------------------------------------------

const validRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    'Client Name': 'Ravi Kumar',
    'Contact Number': '9876543210',
    ...overrides,
});

// ---------------------------------------------------------------------------
// validateClientRow — required fields
// ---------------------------------------------------------------------------

describe('validateClientRow — required fields', () => {
    it('is valid for a minimal row with name and mobile', () => {
        const result = validateClientRow(validRow());
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('errors when name is missing', () => {
        const result = validateClientRow({ 'Contact Number': '9876543210' });
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing Client Name');
    });

    it('errors when mobile is missing', () => {
        const result = validateClientRow({ 'Client Name': 'Ravi Kumar' });
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Missing Mobile Number');
    });
});

// ---------------------------------------------------------------------------
// validateClientRow — phone parsing
// ---------------------------------------------------------------------------

describe('validateClientRow — phone parsing', () => {
    it('accepts a plain 10-digit Indian number', () => {
        const { client, isValid } = validateClientRow(validRow({ 'Contact Number': '9876543210' }));
        expect(isValid).toBe(true);
        expect(client.mobile).toBe('9876543210');
        expect(client.countryCode).toBe('+91');
    });

    it('strips the 91 country prefix from a 12-digit string', () => {
        const { client } = validateClientRow(validRow({ 'Contact Number': '919876543210' }));
        expect(client.mobile).toBe('9876543210');
        expect(client.countryCode).toBe('+91');
    });

    it('strips formatting characters before parsing', () => {
        const { client, isValid } = validateClientRow(validRow({ 'Contact Number': '+91 98765-43210' }));
        expect(isValid).toBe(true);
        expect(client.mobile).toBe('9876543210');
    });

    it('flags a number with fewer than 10 digits as invalid', () => {
        const { isValid, errors } = validateClientRow(validRow({ 'Contact Number': '12345' }));
        expect(isValid).toBe(false);
        expect(errors.some(e => e.includes('Invalid Mobile Number'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// validateClientRow — duplicate detection
// ---------------------------------------------------------------------------

describe('validateClientRow — duplicate detection', () => {
    const existing: Client[] = [
        {
            id: 'abc123',
            clientName: 'Ravi Kumar',
            mobile: '9876543210',
            countryCode: '+91',
            email: '',
            clientType: 'Prospect',
            status: 'Active',
            frequency: 'Monthly',
            nextFollowUpDate: new Date().toISOString(),
            notes: '',
            createdAt: new Date().toISOString(),
        },
    ];

    it('detects a duplicate by normalised mobile', () => {
        const result = validateClientRow(validRow({ 'Contact Number': '9876543210' }), existing);
        expect(result.isDuplicate).toBe(true);
        expect(result.duplicateOfId).toBe('abc123');
    });

    it('detects duplicate even when import has country-code prefix', () => {
        const result = validateClientRow(validRow({ 'Contact Number': '919876543210' }), existing);
        expect(result.isDuplicate).toBe(true);
    });

    it('does not flag a different number as duplicate', () => {
        const result = validateClientRow(validRow({ 'Contact Number': '9000000001' }), existing);
        expect(result.isDuplicate).toBe(false);
    });

    it('duplicate row gets a new id, never the existing client id', () => {
        const result = validateClientRow(validRow({ 'Contact Number': '9876543210' }), existing);
        expect(result.client.id).not.toBe('abc123');
    });
});

// ---------------------------------------------------------------------------
// validateClientRow — date parsing
// ---------------------------------------------------------------------------

describe('validateClientRow — date parsing', () => {
    it('accepts MM/DD/YYYY format', () => {
        const { client, isValid, errors } = validateClientRow(
            validRow({ 'Next Call Date': '12/31/2025' })
        );
        expect(isValid).toBe(true);
        expect(errors.some(e => e.includes('Date'))).toBe(false);
        expect(new Date(client.nextFollowUpDate).getFullYear()).toBe(2025);
    });

    it('accepts YYYY-MM-DD format', () => {
        const { client } = validateClientRow(validRow({ 'Next Call Date': '2025-06-15' }));
        expect(new Date(client.nextFollowUpDate).getMonth()).toBe(5); // June = 5
    });

    it('accepts a JS Date object directly', () => {
        const d = new Date('2025-03-01');
        const { client } = validateClientRow(validRow({ 'Next Call Date': d }));
        expect(new Date(client.nextFollowUpDate).getFullYear()).toBe(2025);
    });

    it('accepts an Excel serial number', () => {
        // Excel serial 45658 ≈ 2025-01-01
        const { client } = validateClientRow(validRow({ 'Next Call Date': 45658 }));
        expect(new Date(client.nextFollowUpDate).getFullYear()).toBe(2025);
    });

    it('errors on a completely unparseable date string', () => {
        const { isValid, errors } = validateClientRow(validRow({ 'Next Call Date': 'not-a-date' }));
        expect(isValid).toBe(false);
        expect(errors.some(e => e.includes('Invalid Date'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// validateClientRow — enum coercion (type, status, frequency)
// ---------------------------------------------------------------------------

describe('validateClientRow — enum coercion', () => {
    it('accepts valid enum values case-insensitively', () => {
        const { client, isValid } = validateClientRow(
            validRow({ Type: 'prospect', Status: 'ACTIVE', Frequency: 'weekly' })
        );
        expect(isValid).toBe(true);
        expect(client.clientType).toBe('Prospect');
        expect(client.status).toBe('Active');
        expect(client.frequency).toBe('Weekly');
    });

    it('defaults unknown Type to Prospect and adds an error', () => {
        const { client, errors } = validateClientRow(validRow({ Type: 'VIP' }));
        expect(client.clientType).toBe('Prospect');
        expect(errors.some(e => e.includes('Unknown Type'))).toBe(true);
    });

    it('defaults unknown Status to Active and adds an error', () => {
        const { client, errors } = validateClientRow(validRow({ Status: 'Pending' }));
        expect(client.status).toBe('Active');
        expect(errors.some(e => e.includes('Unknown Status'))).toBe(true);
    });

    it('defaults unknown Frequency to Monthly and adds an error', () => {
        const { client, errors } = validateClientRow(validRow({ Frequency: 'Yearly' }));
        expect(client.frequency).toBe('Monthly');
        expect(errors.some(e => e.includes('Unknown Frequency'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// validateClientRow — header mapping (aliases)
// ---------------------------------------------------------------------------

describe('validateClientRow — header aliases', () => {
    it('maps "Full Name" → clientName', () => {
        const { client } = validateClientRow({ 'Full Name': 'Priya Singh', Phone: '9000000001' });
        expect(client.clientName).toBe('Priya Singh');
    });

    it('maps "Primary Phone" → mobile', () => {
        const { isValid } = validateClientRow({ Name: 'Test', 'Primary Phone': '9000000001' });
        expect(isValid).toBe(true);
    });

    it('maps "Email Address" → email', () => {
        const { client } = validateClientRow(
            validRow({ 'Email Address': 'test@example.com' })
        );
        expect(client.email).toBe('test@example.com');
    });

    it('maps "Remarks" → notes', () => {
        const { client } = validateClientRow(validRow({ Remarks: 'Follow up after trip' }));
        expect(client.notes).toBe('Follow up after trip');
    });
});

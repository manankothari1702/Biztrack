import ExcelJS from 'exceljs';
import { parse, isValid } from 'date-fns';
import type { Client } from '../types';

const MAX_EXCEL_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_EXCEL_EXTENSIONS = /\.(xlsx|csv)$/i;

// ==========================================
// EXPORTS
// ==========================================

export const exportToExcel = async (data: Record<string, unknown>[], fileName: string): Promise<void> => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
    if (data.length > 0) {
        worksheet.columns = Object.keys(data[0]).map(key => ({ header: key, key, width: 20 }));
        data.forEach(row => worksheet.addRow(row));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    triggerDownload(buffer, `${fileName}.xlsx`);
};

export const exportClientsToExcel = async (clients: Client[]): Promise<void> => {
    const sortedClients = [...clients].sort((a, b) => {
        const dateA = new Date(a.nextFollowUpDate || 0).getTime();
        const dateB = new Date(b.nextFollowUpDate || 0).getTime();
        return dateA - dateB;
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('All Clients Database');

    worksheet.columns = [
        { header: 'Client ID',           key: 'id',               width: 20 },
        { header: 'Client Name',         key: 'clientName',       width: 25 },
        { header: 'Contact Number',      key: 'mobile',           width: 18 },
        { header: 'Email',               key: 'email',            width: 30 },
        { header: 'Type',                key: 'clientType',       width: 15 },
        { header: 'Status',              key: 'status',           width: 12 },
        { header: 'Next Call Date',      key: 'nextFollowUpDate', width: 15 },
        { header: 'Follow-up Frequency',key: 'frequency',        width: 20 },
        { header: 'Notes',              key: 'notes',            width: 40 },
        { header: 'Created At',          key: 'createdAt',        width: 15 },
    ];

    sortedClients.forEach(client => {
        worksheet.addRow({
            id:               client.id || '',
            clientName:       client.clientName || '',
            mobile:           client.mobile ? String(client.mobile) : '',
            email:            client.email || '',
            clientType:       client.clientType || '',
            status:           client.status || '',
            nextFollowUpDate: formatDate(client.nextFollowUpDate),
            frequency:        client.frequency || '',
            notes:            client.notes || '',
            createdAt:        formatDate(client.createdAt),
        });
    });

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm   = String(today.getMonth() + 1).padStart(2, '0');
    const dd   = String(today.getDate()).padStart(2, '0');

    const buffer = await workbook.xlsx.writeBuffer();
    triggerDownload(buffer, `BizTrack_AllClients_${yyyy}-${mm}-${dd}.xlsx`);
};

const triggerDownload = (buffer: ArrayBuffer, fileName: string): void => {
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    try {
        link.click();
    } finally {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
};

// Kept for backward compatibility
export const normalizeMobile = (mobile: string | number): string => {
    if (!mobile) return '';
    return String(mobile).replace(/\D/g, '');
};

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    client: Client;
    isDuplicate: boolean;
    duplicateOfId?: string;
}

// ==========================================
// IMPORT LOGIC
// ==========================================

export const parseExcel = async (file: File): Promise<any[]> => {
    if (file.size > MAX_EXCEL_SIZE_BYTES) {
        throw new Error('File too large. Maximum allowed size is 5 MB.');
    }
    if (!ALLOWED_EXCEL_EXTENSIONS.test(file.name)) {
        throw new Error('Invalid file type. Only .xlsx or .csv files are allowed.');
    }

    const buffer = await file.arrayBuffer();

    // 1. Read all rows as array-of-arrays
    const rawRows: unknown[][] = file.name.toLowerCase().endsWith('.csv')
        ? parseCSV(buffer)
        : await parseXlsx(buffer);

    // 2. Detect header row by scanning first 20 rows
    const requiredName   = ['name', 'fullname', 'clientname'];
    const requiredMobile = ['primaryphone', 'phone', 'mobile', 'contact', 'contactnumber'];

    let headerRowIndex = 0;
    let foundHeader = false;

    for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
        const rowValues = rawRows[i].map(val =>
            String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        );
        const hasName   = rowValues.some(v => requiredName.includes(v));
        const hasMobile = rowValues.some(v => requiredMobile.includes(v));
        if (hasName && hasMobile) {
            headerRowIndex = i;
            foundHeader = true;
            break;
        }
    }

    // 3. Build JSON objects using detected header row
    const headerRow = rawRows[foundHeader ? headerRowIndex : 0];
    const dataRows  = rawRows.slice((foundHeader ? headerRowIndex : 0) + 1);

    return dataRows.map(row => {
        const obj: Record<string, unknown> = {};
        headerRow.forEach((header, i) => {
            const key = String(header ?? '').trim();
            if (key) obj[key] = row[i] ?? '';
        });
        return obj;
    });
};

// ==========================================
// INTERNAL PARSERS
// ==========================================

const parseXlsx = async (buffer: ArrayBuffer): Promise<unknown[][]> => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];

    const rows: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
        // row.values is 1-indexed; index 0 is always undefined — drop it
        const values = (row.values as unknown[]).slice(1);
        rows.push(values.map(extractCellValue));
    });
    return rows;
};

const extractCellValue = (cell: unknown): unknown => {
    if (cell === null || cell === undefined) return '';
    if (cell instanceof Date) return cell;
    if (typeof cell === 'object') {
        const obj = cell as Record<string, unknown>;
        // Rich text: { richText: [{ text: '...' }, ...] }
        if (Array.isArray(obj.richText)) {
            return (obj.richText as Array<{ text: string }>).map(rt => rt.text).join('');
        }
        // Formula cell: { formula: '...', result: value }
        if ('result' in obj) return extractCellValue(obj.result);
        // Hyperlink: { text: '...', hyperlink: '...' }
        if (typeof obj.text === 'string') return obj.text;
        // Error or unrecognised object
        return '';
    }
    return cell;
};

/**
 * RFC-4180-compatible CSV parser.
 * Handles quoted fields, embedded commas, doubled-quote escapes, and BOM.
 */
const parseCSV = (buffer: ArrayBuffer): unknown[][] => {
    const text = new TextDecoder('utf-8').decode(buffer);
    // Strip UTF-8 BOM if present
    const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const lines  = clean.split(/\r?\n/).filter(line => line.trim());

    return lines.map(line => {
        const cells: string[] = [];
        let inQuotes = false;
        let cell = '';

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped quote inside quoted field
                    cell += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                cells.push(cell.trim());
                cell = '';
            } else {
                cell += ch;
            }
        }
        cells.push(cell.trim());
        return cells;
    });
};

// ==========================================
// VALIDATION
// ==========================================

export const validateClientRow = (row: Record<string, unknown>, existingClients: Client[] = []): ValidationResult => {
    const errors: string[] = [];
    let isDuplicate = false;
    let duplicateOfId: string | undefined = undefined;

    // -- 1. Value Extraction --
    const getName      = () => findValue(row, ['clientname', 'fullname', 'name']);
    const getMobile    = () => findValue(row, ['mobile', 'primaryphone', 'phone', 'contact', 'contactnumber', 'phoneno']);
    const getEmail     = () => findValue(row, ['email', 'emailaddress']);
    const getType      = () => findValue(row, ['clienttype', 'type', 'category', 'role']);
    const getStatus    = () => findValue(row, ['status', 'state', 'currentstatus']);
    const getFreq      = () => findValue(row, ['frequency', 'followupfrequency', 'recurrence']);
    const getDate      = () => findValue(row, ['nextfollowupdate', 'nextcall', 'nextcalldate', 'calldate', 'followup', 'followupdate']);
    const getNotes     = () => findValue(row, ['notes', 'note', 'remark', 'remarks', 'description', 'comment']);
    const getCreatedAt = () => findValue(row, ['createdat', 'createdon', 'dateadded']);
    const getId        = () => findValue(row, ['id', 'clientid']);

    const clientName = getName();
    const rawMobile  = getMobile();
    const rawEmail   = getEmail();
    const rawDate    = getDate();

    // -- 2. Required Field Checks --
    if (!clientName) errors.push('Missing Client Name');
    if (!rawMobile)  errors.push('Missing Mobile Number');

    // -- 3. Mobile Processing --
    const { mobile, countryCode, isValid: isMobileValid } = parsePhoneNumber(rawMobile);

    if (rawMobile && !isMobileValid) {
        errors.push('Invalid Mobile Number (must be at least 10 digits)');
    }

    // -- 4. Duplicate Check --
    if (isMobileValid && mobile) {
        const existing = existingClients.find(c => {
            const { mobile: existingMobile } = parsePhoneNumber(c.mobile);
            return existingMobile === mobile;
        });
        if (existing) {
            isDuplicate = true;
            duplicateOfId = existing.id;
        }
    }

    // -- 5. Date processing --
    let finalNextDate = new Date().toISOString();
    if (rawDate) {
        const parsed = parseFlexibleDate(rawDate);
        if (parsed) {
            finalNextDate = parsed;
        } else {
            errors.push('Invalid Date Format. Use MM/DD/YYYY');
        }
    }

    // -- 6. Validate and coerce enum fields --
    const clientType = resolveEnum(
        getType(),
        ['Prospect', 'User', 'Associate', 'Supervisor'] as const,
        'Prospect'
    );
    if (getType() && clientType.coerced) {
        errors.push(`Unknown Type "${getType()}" — defaulted to "Prospect"`);
    }

    const status = resolveEnum(
        getStatus(),
        ['Active', 'Archived', 'Converted'] as const,
        'Active'
    );
    if (getStatus() && status.coerced) {
        errors.push(`Unknown Status "${getStatus()}" — defaulted to "Active"`);
    }

    const frequency = resolveEnum(
        getFreq(),
        ['Daily', 'Weekly', 'Bi-Weekly', 'Monthly'] as const,
        'Monthly'
    );
    if (getFreq() && frequency.coerced) {
        errors.push(`Unknown Frequency "${getFreq()}" — defaulted to "Monthly"`);
    }

    // -- 7. Construct Client --
    // Never reuse duplicateOfId as the new client's id — that would overwrite the
    // existing record. duplicateOfId in the return value is enough
    // for the caller to decide whether to skip or merge this row.
    const client: Client = {
        id:               getId() ? String(getId()) : crypto.randomUUID(),
        clientName:       clientName ? String(clientName).trim() : '',
        mobile:           mobile,
        countryCode:      countryCode,
        email:            rawEmail ? String(rawEmail).trim() : '',
        clientType:       clientType.value,
        status:           status.value,
        frequency:        frequency.value,
        nextFollowUpDate: finalNextDate,
        notes:            getNotes() ? String(getNotes()) : '',
        createdAt:        getCreatedAt() ? String(getCreatedAt()) : new Date().toISOString(),
    };

    return { isValid: errors.length === 0, errors, client, isDuplicate, duplicateOfId };
};

// ==========================================
// HELPERS
// ==========================================

const findValue = (row: Record<string, unknown>, targetKeys: string[]): unknown => {
    const normalizedRowKeys = Object.keys(row).reduce((acc, key) => {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        acc[normalized] = key;
        return acc;
    }, {} as Record<string, string>);

    for (const target of targetKeys) {
        if (normalizedRowKeys[target]) {
            return row[normalizedRowKeys[target]];
        }
    }
    return undefined;
};

const resolveEnum = <T extends string>(
    raw: unknown,
    validValues: readonly T[],
    defaultValue: T
): { value: T; coerced: boolean } => {
    if (!raw) return { value: defaultValue, coerced: false };
    const normalized = String(raw).trim().toLowerCase();
    const match = validValues.find(v => v.toLowerCase() === normalized);
    if (match) return { value: match, coerced: false };
    return { value: defaultValue, coerced: true };
};

const parsePhoneNumber = (raw: unknown): { mobile: string, countryCode: string, isValid: boolean } => {
    const str = String(raw || '').replace(/\D/g, '');

    if (str.length < 10) {
        return { mobile: str, countryCode: '+91', isValid: false };
    }

    let countryCode = '+91';
    let mobile = str;

    if (str.length === 12 && str.startsWith('91')) {
        countryCode = '+91';
        mobile = str.substring(2);
    } else if (str.length === 10) {
        countryCode = '+91';
        mobile = str;
    } else if (str.length > 10) {
        const splitIndex = str.length - 10;
        const prefix = str.substring(0, splitIndex);
        if (prefix.length > 4) {
            countryCode = '+91';
            mobile = str.substring(splitIndex);
        } else {
            countryCode = '+' + prefix;
            mobile = str.substring(splitIndex);
        }
    }

    return { mobile, countryCode, isValid: true };
};

const formatDate = (dateVal: any): string => {
    if (!dateVal) return '';
    let date: Date;
    if (typeof dateVal === 'object' && dateVal && typeof dateVal.toDate === 'function') {
        date = dateVal.toDate();
    } else {
        date = new Date(dateVal);
    }
    if (isNaN(date.getTime())) return '';
    const day   = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year  = date.getFullYear();
    return `${day}/${month}/${year}`;
};

const parseFlexibleDate = (value: any): string | null => {
    if (!value) return null;
    if (typeof value === 'number') {
        const date = new Date(Math.round((value - 25569) * 86400 * 1000));
        return !isNaN(date.getTime()) ? date.toISOString() : null;
    }
    if (value instanceof Date) {
        return !isNaN(value.getTime()) ? value.toISOString() : null;
    }

    const str = String(value).trim();
    if (!str) return null;

    const formatsToTry = ['MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd', 'dd-MM-yyyy', 'MM-dd-yyyy'];
    for (const fmt of formatsToTry) {
        const d = parse(str, fmt, new Date());
        if (isValid(d) && d.getFullYear() > 1900 && d.getFullYear() < 2100) {
            return d.toISOString();
        }
    }

    const jsDate = new Date(str);
    if (!isNaN(jsDate.getTime()) && jsDate.getFullYear() > 1900) {
        return jsDate.toISOString();
    }

    return null;
};
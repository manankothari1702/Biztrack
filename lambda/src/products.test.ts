import { describe, expect, it } from 'vitest';
import {
    addDaysIso,
    catalogueDefaults,
    mergeProductItem,
    newProductItem,
    normalizeStockNo,
    planBulkUpsert,
    sortProducts,
    stripServerOwned,
    todayIso,
    validateCatalogue,
} from './products';

const UID = 'u_1';
const NOW = '2026-07-22T10:00:00.000Z';

/** A minimally valid catalogue row. */
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'Formula 1 - Strawberry - 500 gms',
    stockNo: '1239',
    category: 'Weight Management',
    vp: 21.75, retail: 2075, price25: 1713, price35: 1526, price42: 1396, price50: 1246,
    reorderLevel: 10,
    ...over,
});

/** A stored product row, complete with the roll-ups only lib/stock.ts may write. */
const stored = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...row(),
    id: 'p_1',
    nameLower: 'formula 1 - strawberry - 500 gms',
    totalQuantity: 20,
    earliestExpiry: '2026-11-15',
    createdAt: '2026-01-05T08:00:00.000Z',
    ...over,
});

const itemsOf = (reqs: { PutRequest?: { Item: Record<string, unknown> } }[]) =>
    reqs.map(r => r.PutRequest!.Item);

// ── normalizeStockNo ────────────────────────────────────────────────────────

describe('normalizeStockNo', () => {
    it('upper-cases so a hand-edited "127k" matches the catalogue "127K"', () => {
        expect(normalizeStockNo('127k')).toBe('127K');
        expect(normalizeStockNo('127K')).toBe('127K');
        expect(normalizeStockNo('529k')).toBe('529K');
    });

    it('trims surrounding whitespace', () => {
        expect(normalizeStockNo('  127K  ')).toBe('127K');
        expect(normalizeStockNo('\t1239\n')).toBe('1239');
        expect(normalizeStockNo(' 127k ')).toBe('127K');
    });

    it('treats blank as absent', () => {
        expect(normalizeStockNo('')).toBeNull();
        expect(normalizeStockNo('   ')).toBeNull();
    });

    it('treats a non-string as absent rather than coercing', () => {
        expect(normalizeStockNo(undefined)).toBeNull();
        expect(normalizeStockNo(null)).toBeNull();
        expect(normalizeStockNo(1239)).toBeNull();
        expect(normalizeStockNo({})).toBeNull();
    });

    it('leaves purely numeric codes untouched', () => {
        expect(normalizeStockNo('1239')).toBe('1239');
    });
});

describe('duplicate stockNo in one import is rejected with its row index', () => {
    it('rejects an exact repeat', () => {
        const result = planBulkUpsert({
            uid: UID, existing: [], now: NOW, newId: () => 'new',
            rows: [row({ stockNo: '1239' }), row({ stockNo: '1239' })],
        });
        expect(result).toEqual({ error: { row: 1, message: expect.stringContaining('duplicate stockNo') } });
    });

    it('rejects a repeat that only differs by case or whitespace', () => {
        const result = planBulkUpsert({
            uid: UID, existing: [], now: NOW, newId: () => 'new',
            rows: [row({ stockNo: '127K' }), row({ stockNo: ' 127k ' })],
        });
        expect('error' in result && result.error.row).toBe(1);
    });

    it('reports the FIRST offending row, not the last', () => {
        const result = planBulkUpsert({
            uid: UID, existing: [], now: NOW, newId: () => 'new',
            rows: [row({ stockNo: 'A' }), row({ stockNo: 'B' }), row({ stockNo: 'a' }), row({ stockNo: 'b' })],
        });
        expect('error' in result && result.error.row).toBe(2);
    });

    it('emits NO writes at all when a row is rejected', () => {
        const result = planBulkUpsert({
            uid: UID, existing: [], now: NOW, newId: () => 'new',
            rows: [row({ stockNo: '1239' }), row({ stockNo: '1239' })],
        });
        expect(result).not.toHaveProperty('creates');
    });

    it('does not collide rows that simply have no stockNo', () => {
        const result = planBulkUpsert({
            uid: UID, existing: [], now: NOW, newId: () => 'new',
            rows: [row({ stockNo: undefined, name: 'A' }), row({ stockNo: '', name: 'B' })],
        });
        expect('creates' in result && result.creates).toHaveLength(2);
    });

    it('surfaces a validation failure with its row index too', () => {
        const result = planBulkUpsert({
            uid: UID, existing: [], now: NOW, newId: () => 'new',
            rows: [row(), row({ name: '' })],
        });
        expect(result).toEqual({ error: { row: 1, message: 'name is required' } });
    });
});

// ── Roll-up preservation ────────────────────────────────────────────────────

describe('roll-up preservation — a catalogue edit can never move stock', () => {
    // The exact attack: a client PUTs the whole Product it was handed, with
    // stale or forged roll-ups. Stock lives on batches; these are caches that
    // only lib/stock.ts may write, inside the transaction that moves them.
    const hostile = row({
        name:           'Formula 1 - Strawberry - 500 gms (renamed)',
        totalQuantity:  9999,
        earliestExpiry: '2099-01-01',
        invDate:        '2099-01-01',
    });

    it('keeps the ORIGINAL stored roll-ups, not the submitted ones', () => {
        const item = mergeProductItem({ uid: UID, existing: stored(), body: hostile, now: NOW });
        expect(item.totalQuantity).toBe(20);
        expect(item.earliestExpiry).toBe('2026-11-15');
    });

    it('does not zero them either', () => {
        const item = mergeProductItem({ uid: UID, existing: stored(), body: hostile, now: NOW });
        expect(item.totalQuantity).not.toBe(0);
    });

    it('drops invDate entirely — it is a GSI key owned by batches and invoices', () => {
        const item = mergeProductItem({ uid: UID, existing: stored(), body: hostile, now: NOW });
        expect(item).not.toHaveProperty('invDate');
    });

    it('still applies the legitimate catalogue edit', () => {
        const item = mergeProductItem({ uid: UID, existing: stored(), body: hostile, now: NOW });
        expect(item.name).toBe('Formula 1 - Strawberry - 500 gms (renamed)');
        expect(item.nameLower).toBe('formula 1 - strawberry - 500 gms (renamed)');
    });

    it('preserves createdAt from the stored row and stamps updatedAt', () => {
        const item = mergeProductItem({ uid: UID, existing: stored(), body: hostile, now: NOW });
        expect(item.createdAt).toBe('2026-01-05T08:00:00.000Z');
        expect(item.updatedAt).toBe(NOW);
    });

    it('keeps a zero roll-up as 0, not undefined', () => {
        const item = mergeProductItem({
            uid: UID, existing: stored({ totalQuantity: 0 }), body: hostile, now: NOW,
        });
        expect(item.totalQuantity).toBe(0);
    });

    it('defaults a missing stored roll-up to 0', () => {
        const item = mergeProductItem({
            uid: UID, existing: stored({ totalQuantity: undefined }), body: hostile, now: NOW,
        });
        expect(item.totalQuantity).toBe(0);
    });

    it('leaves earliestExpiry undefined when the stored row has none', () => {
        const item = mergeProductItem({
            uid: UID, existing: stored({ earliestExpiry: undefined }), body: hostile, now: NOW,
        });
        expect(item.earliestExpiry).toBeUndefined();
    });

    it('pins PK/SK/id from the stored row, ignoring anything in the body', () => {
        const item = mergeProductItem({
            uid: UID,
            existing: stored(),
            body: { ...hostile, id: 'p_HIJACK', PK: 'USER#someone_else', SK: 'PRODUCT#p_HIJACK' },
            now: NOW,
        });
        expect(item.PK).toBe(`USER#${UID}`);
        expect(item.SK).toBe('PRODUCT#p_1');
        expect(item.id).toBe('p_1');
    });

    it('applies identically on the BULK update path', () => {
        const result = planBulkUpsert({
            uid: UID, now: NOW, newId: () => 'unused',
            existing: [stored()],
            rows: [{ ...hostile, stockNo: '1239' }],
        });

        expect('updates' in result).toBe(true);
        if (!('updates' in result)) return;

        expect(result.creates).toHaveLength(0);
        const [item] = itemsOf(result.updates);
        expect(item.totalQuantity).toBe(20);
        expect(item.earliestExpiry).toBe('2026-11-15');
        expect(item).not.toHaveProperty('invDate');
        expect(item.id).toBe('p_1');
        expect(item.createdAt).toBe('2026-01-05T08:00:00.000Z');
    });

    it('matches an existing row case-insensitively on stockNo', () => {
        const result = planBulkUpsert({
            uid: UID, now: NOW, newId: () => 'new_id',
            existing: [stored({ stockNo: '127K' })],
            rows: [row({ stockNo: '127k', name: 'Re-imported' })],
        });
        expect('updates' in result && result.updates).toHaveLength(1);
        expect('creates' in result && result.creates).toHaveLength(0);
    });

    it('creates rather than updates when no stockNo matches', () => {
        const result = planBulkUpsert({
            uid: UID, now: NOW, newId: () => 'new_id',
            existing: [stored({ stockNo: '1239' })],
            rows: [row({ stockNo: '9999' })],
        });
        expect('creates' in result && result.creates).toHaveLength(1);
        expect('creates' in result && itemsOf(result.creates)[0].id).toBe('new_id');
    });
});

describe('newProductItem — a new catalogue row starts empty', () => {
    it('forces totalQuantity to 0 even when the body claims stock', () => {
        const item = newProductItem({
            uid: UID, id: 'p_new', now: NOW,
            body: row({ totalQuantity: 500, earliestExpiry: '2027-01-01' }),
        });
        expect(item.totalQuantity).toBe(0);
        expect(item.earliestExpiry).toBeUndefined();
    });

    it('spreads the key helper last so PK/SK cannot be hijacked', () => {
        const item = newProductItem({
            uid: UID, id: 'p_new', now: NOW,
            body: { ...row(), PK: 'USER#attacker', SK: 'PRODUCT#evil' },
        });
        expect(item.PK).toBe(`USER#${UID}`);
        expect(item.SK).toBe('PRODUCT#p_new');
    });

    it('stamps createdAt from the injected clock, honouring an explicit one', () => {
        expect(newProductItem({ uid: UID, id: 'p', now: NOW, body: row() }).createdAt).toBe(NOW);
        expect(newProductItem({
            uid: UID, id: 'p', now: NOW, body: row({ createdAt: '2020-01-01T00:00:00.000Z' }),
        }).createdAt).toBe('2020-01-01T00:00:00.000Z');
    });
});

describe('stripServerOwned', () => {
    it('removes exactly the three server-owned fields', () => {
        const out = stripServerOwned({ a: 1, totalQuantity: 5, earliestExpiry: 'x', invDate: 'y' });
        expect(out).toEqual({ a: 1 });
    });

    it('does not mutate its input', () => {
        const input = { totalQuantity: 5 };
        stripServerOwned(input);
        expect(input.totalQuantity).toBe(5);
    });
});

// ── catalogueDefaults ───────────────────────────────────────────────────────

describe('catalogueDefaults', () => {
    it('defaults reorderLevel to 0 and preserves an explicit value', () => {
        expect(catalogueDefaults({ name: 'x' }).reorderLevel).toBe(0);
        expect(catalogueDefaults({ name: 'x', reorderLevel: 10 }).reorderLevel).toBe(10);
        expect(catalogueDefaults({ name: 'x', reorderLevel: 0 }).reorderLevel).toBe(0);
    });

    it('defaults unit to "units" and preserves an explicit one', () => {
        expect(catalogueDefaults({ name: 'x' }).unit).toBe('units');
        expect(catalogueDefaults({ name: 'x', unit: 'bottles' }).unit).toBe('bottles');
        expect(catalogueDefaults({ name: 'x', unit: '  boxes  ' }).unit).toBe('boxes');
        expect(catalogueDefaults({ name: 'x', unit: '   ' }).unit).toBe('units');
        expect(catalogueDefaults({ name: 'x', unit: 42 }).unit).toBe('units');
    });

    it('falls back to the Other category', () => {
        expect(catalogueDefaults({ name: 'x' }).category).toBe('Other');
        expect(catalogueDefaults({ name: 'x', category: '' }).category).toBe('Other');
        expect(catalogueDefaults({ name: 'x', category: '   ' }).category).toBe('Other');
        expect(catalogueDefaults({ name: 'x', category: 7 }).category).toBe('Other');
        expect(catalogueDefaults({ name: 'x', category: 'Energy' }).category).toBe('Energy');
        expect(catalogueDefaults({ name: 'x', category: ' Energy ' }).category).toBe('Energy');
    });

    it('trims the name and derives nameLower for search', () => {
        const out = catalogueDefaults({ name: '  Afresh Lemon  ' });
        expect(out.name).toBe('Afresh Lemon');
        expect(out.nameLower).toBe('afresh lemon');
    });

    it('zero-fills every missing price so the UI never renders NaN', () => {
        const out = catalogueDefaults({ name: 'x' });
        for (const f of ['vp', 'retail', 'price25', 'price35', 'price42', 'price50']) {
            expect(out[f]).toBe(0);
        }
    });

    it('preserves supplied prices, including a legitimate 0', () => {
        const out = catalogueDefaults({ name: 'x', vp: 21.75, price50: 1246, retail: 0 });
        expect(out.vp).toBe(21.75);
        expect(out.price50).toBe(1246);
        expect(out.retail).toBe(0);
    });

    it('trims stockNo, and omits it entirely when blank', () => {
        expect(catalogueDefaults({ name: 'x', stockNo: '  127K ' }).stockNo).toBe('127K');
        expect(catalogueDefaults({ name: 'x', stockNo: '   ' })).not.toHaveProperty('stockNo');
        expect(catalogueDefaults({ name: 'x' })).not.toHaveProperty('stockNo');
    });
});

// ── sortProducts ────────────────────────────────────────────────────────────

describe('sortProducts', () => {
    const p = (over: Record<string, unknown>) => ({ name: 'x', nameLower: 'x', ...over });

    it('sorts by name by default, and for an unknown sortBy', () => {
        const input = [p({ nameLower: 'zinc' }), p({ nameLower: 'afresh' }), p({ nameLower: 'formula 1' })];
        expect(sortProducts(input).map(x => x.nameLower)).toEqual(['afresh', 'formula 1', 'zinc']);
        expect(sortProducts(input, 'nonsense').map(x => x.nameLower)).toEqual(['afresh', 'formula 1', 'zinc']);
        expect(sortProducts(input, 'name').map(x => x.nameLower)).toEqual(['afresh', 'formula 1', 'zinc']);
    });

    it('sorts by stockNo', () => {
        const input = [p({ stockNo: '1295' }), p({ stockNo: '127K' }), p({ stockNo: '1233' })];
        expect(sortProducts(input, 'stockNo').map(x => x.stockNo)).toEqual(['1233', '127K', '1295']);
    });

    it('sorts by quantity, most stock first', () => {
        const input = [p({ totalQuantity: 5 }), p({ totalQuantity: 20 }), p({ totalQuantity: 0 })];
        expect(sortProducts(input, 'quantity').map(x => x.totalQuantity)).toEqual([20, 5, 0]);
    });

    it('sorts by value = quantity x price50, most valuable first', () => {
        const input = [
            p({ name: 'a', totalQuantity: 20, price50: 100 }),   //  2000
            p({ name: 'b', totalQuantity: 2,  price50: 5000 }),  // 10000
            p({ name: 'c', totalQuantity: 1,  price50: 100 }),   //   100
        ];
        expect(sortProducts(input, 'value').map(x => x.name)).toEqual(['b', 'a', 'c']);
    });

    it('sorts by expiry soonest-first, with un-stocked products LAST', () => {
        const input = [
            p({ name: 'none' }),
            p({ name: 'later',  earliestExpiry: '2027-06-30' }),
            p({ name: 'sooner', earliestExpiry: '2026-11-15' }),
        ];
        expect(sortProducts(input, 'expiry').map(x => x.name)).toEqual(['sooner', 'later', 'none']);
    });

    it('is stable on ties, for every sort key', () => {
        const tied = [
            p({ name: 'first',  nameLower: 'same', stockNo: 'S', totalQuantity: 5, price50: 10, earliestExpiry: '2027-01-01' }),
            p({ name: 'second', nameLower: 'same', stockNo: 'S', totalQuantity: 5, price50: 10, earliestExpiry: '2027-01-01' }),
            p({ name: 'third',  nameLower: 'same', stockNo: 'S', totalQuantity: 5, price50: 10, earliestExpiry: '2027-01-01' }),
        ];
        for (const key of ['name', 'stockNo', 'quantity', 'value', 'expiry']) {
            expect(sortProducts(tied, key).map(x => x.name)).toEqual(['first', 'second', 'third']);
        }
    });

    it('returns a new array and does not mutate the input', () => {
        const input = [p({ nameLower: 'z' }), p({ nameLower: 'a' })];
        const out   = sortProducts(input);
        expect(out).not.toBe(input);
        expect(input.map(x => x.nameLower)).toEqual(['z', 'a']);
    });

    it('handles missing fields without throwing', () => {
        expect(() => sortProducts([{}, {}], 'value')).not.toThrow();
        expect(sortProducts([], 'name')).toEqual([]);
    });
});

// ── addDaysIso / todayIso ───────────────────────────────────────────────────

describe('addDaysIso', () => {
    it('takes and returns date-only ISO strings', () => {
        expect(addDaysIso('2026-07-22', 30)).toBe('2026-08-21');
        expect(addDaysIso('2026-07-22', 0)).toBe('2026-07-22');
        expect(addDaysIso('2026-07-22', 1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('crosses month boundaries in both directions', () => {
        expect(addDaysIso('2026-01-31', 1)).toBe('2026-02-01');
        expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
        expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01');
    });

    it('crosses year boundaries in both directions', () => {
        expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDaysIso('2027-01-01', -1)).toBe('2026-12-31');
        expect(addDaysIso('2026-12-01', 60)).toBe('2027-01-30');
    });

    it('handles leap years', () => {
        expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');   // 2028 is a leap year
        expect(addDaysIso('2028-02-29', 1)).toBe('2028-03-01');
        expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');   // 2026 is not
        expect(addDaysIso('2100-02-28', 1)).toBe('2100-03-01');   // century, not a leap year
    });

    it('does not drift with the host timezone', () => {
        // A local-midnight implementation lands a day early or late for anyone
        // off UTC. Adding a day 365 times must equal adding 365 once, and must
        // land on the same calendar date regardless of where the box is.
        let walked = '2026-01-01';
        for (let i = 0; i < 365; i++) walked = addDaysIso(walked, 1);
        expect(walked).toBe('2027-01-01');
        expect(addDaysIso('2026-01-01', 365)).toBe('2027-01-01');
    });

    it('round-trips: +n then -n returns the original date', () => {
        for (const [date, n] of [['2026-07-22', 30], ['2026-12-31', 1], ['2028-02-29', 400]] as const) {
            expect(addDaysIso(addDaysIso(date, n), -n)).toBe(date);
        }
    });

    it('produces dates that compare lexicographically in chronological order', () => {
        const today = '2026-07-22';
        expect(addDaysIso(today, -1) < today).toBe(true);
        expect(today < addDaysIso(today, 1)).toBe(true);
        expect(addDaysIso(today, 30) < addDaysIso(today, 31)).toBe(true);
    });
});

describe('todayIso', () => {
    it('returns a date-only ISO string', () => {
        expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('resolves the day in the requested timezone, not the host or UTC', () => {
        // 26 hours apart — they cannot share a calendar day at any instant.
        expect(todayIso('Pacific/Kiritimati')).not.toBe(todayIso('Etc/GMT+12'));
    });
});

// ── validateCatalogue ───────────────────────────────────────────────────────

describe('validateCatalogue', () => {
    it('accepts a well-formed row', () => {
        expect(validateCatalogue(row())).toBeNull();
    });

    it('requires a non-blank name', () => {
        expect(validateCatalogue(row({ name: undefined }))).toBe('name is required');
        expect(validateCatalogue(row({ name: '' }))).toBe('name is required');
        expect(validateCatalogue(row({ name: '   ' }))).toBe('name is required');
        expect(validateCatalogue(row({ name: 123 }))).toBe('name is required');
    });

    it('rejects a negative or non-numeric price', () => {
        expect(validateCatalogue(row({ price50: -1 }))).toMatch(/price50/);
        expect(validateCatalogue(row({ vp: 'free' }))).toMatch(/vp/);
        expect(validateCatalogue(row({ retail: NaN }))).toMatch(/retail/);
        expect(validateCatalogue(row({ price25: Infinity }))).toMatch(/price25/);
    });

    it('allows an omitted price — catalogueDefaults zero-fills it', () => {
        expect(validateCatalogue(row({ price42: undefined }))).toBeNull();
        expect(validateCatalogue(row({ price42: null }))).toBeNull();
        expect(validateCatalogue(row({ price42: 0 }))).toBeNull();
    });

    it('requires reorderLevel to be a non-negative whole number', () => {
        expect(validateCatalogue(row({ reorderLevel: -1 }))).toMatch(/reorderLevel/);
        expect(validateCatalogue(row({ reorderLevel: 2.5 }))).toMatch(/reorderLevel/);
        expect(validateCatalogue(row({ reorderLevel: '10' }))).toMatch(/reorderLevel/);
        expect(validateCatalogue(row({ reorderLevel: undefined }))).toBeNull();
        expect(validateCatalogue(row({ reorderLevel: 0 }))).toBeNull();
    });

    it('requires stockNo to be a string when present', () => {
        expect(validateCatalogue(row({ stockNo: 1239 }))).toMatch(/stockNo/);
        expect(validateCatalogue(row({ stockNo: undefined }))).toBeNull();
    });
});

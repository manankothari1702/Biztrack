import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
    MAX_INVOICE_LINES,
    cancelInvoice,
    createInvoice,
    deleteInvoice,
    finalizeInvoice,
    formatInvoiceNo,
    getInvoice,
    listInvoices,
    mergePurchaseLines,
    priceInvoice,
    reserveInvoiceNo,
    updateInvoice,
    validateCreateBody,
    type CatalogueProduct,
    type Invoice,
    type Send,
} from './invoices';
import { TABLE } from './lib/db';

const UID   = 'u_1';
const NOW   = '2026-07-23T10:00:00.000Z';
const TODAY = '2026-07-23';

const CATALOGUE: Record<string, CatalogueProduct> = {
    p_1: {
        id: 'p_1', name: 'Formula 1 - Strawberry', stockNo: '1239',
        vp: 21.75, retail: 2075, price25: 1713, price35: 1526, price42: 1396, price50: 1246,
    },
    p_2: {
        id: 'p_2', name: "Woman's Choice", stockNo: '127K',
        vp: 12.45, retail: 1186, price25: 979, price35: 872, price42: 798, price50: 712,
    },
};

/**
 * An in-memory stand-in for the table, in the spirit of batches.test.ts's
 * `project` helper: enough DynamoDB semantics to make the real behaviour
 * observable — the idempotency guard actually guards, and batch deltas actually
 * accumulate — without a live table.
 *
 * It also records the ORDER of commands, which is the only way to assert that
 * the counter is reserved before the transaction rather than inside it.
 */
/** The slices of the SDK command shapes this fake actually reaches into. */
interface TransactItemShape {
    Put?:    { Item: Record<string, unknown>; ConditionExpression?: string };
    Update?: {
        Key: Record<string, unknown>;
        ExpressionAttributeValues?: Record<string, unknown>;
    };
}
interface CommandShape {
    constructor: { name: string };
    input: {
        RequestItems?: Record<string, { Keys: { SK: string }[] }>;
        TransactItems?: TransactItemShape[];
    };
}

/** The union of input fields the stateful `makeStore` fake reads. */
interface StoreCommandInput {
    Key?: { SK: string };
    RequestItems?: Record<string, { Keys: { SK: string }[] }>;
    TransactItems?: TransactItemShape[];
    Item?: Row;
    ConditionExpression?: string;
    UpdateExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, unknown>;
    IndexName?: string;
    ExclusiveStartKey?: { PK?: string; SK?: string; invDate: string };
    Limit?: number;
    ScanIndexForward?: boolean;
}

const makeWorld = (catalogue: Record<string, CatalogueProduct> = CATALOGUE) => {
    const calls: string[] = [];
    const storedInvoices = new Set<string>();
    const batchDeltas: Record<string, number> = {};
    const transactions: TransactItemShape[][] = [];
    let seq = 0;

    const send: Send = async (command: unknown) => {
        const c = command as unknown as CommandShape;
        const name = c.constructor.name;
        calls.push(name);

        if (name === 'BatchGetCommand') {
            const asked = c.input.RequestItems![TABLE].Keys;
            const items = asked
                .map(k => catalogue[String(k.SK).replace('PRODUCT#', '')])
                .filter(Boolean);
            return { Responses: { [TABLE]: items } };
        }

        if (name === 'UpdateCommand') {
            // Only the COUNTER# update reserves a number. The post-transaction
            // earliestExpiry recompute also issues an UpdateCommand (on PRODUCT#)
            // — counting that as a number would make gaps look bigger than they are.
            const sk = String((c as unknown as { input: StoreCommandInput }).input.Key?.SK ?? '');
            if (sk.startsWith('COUNTER#') || sk === '') { seq += 1; return { Attributes: { seq } }; }
            return {};   // recompute product update — a no-op for this fake
        }

        // The recompute reads a product's batches. This fake doesn't model them,
        // so it returns none — earliestExpiryOf([]) => undefined => REMOVE, a no-op.
        if (name === 'QueryCommand') return { Items: [] };

        if (name === 'TransactWriteCommand') {
            const items = c.input.TransactItems!;
            transactions.push(items);

            // Honour the Put's ConditionExpression rather than assuming it.
            // If the fake guarded unconditionally, deleting the real guard would
            // still "pass" the double-deduction test — the exact regression the
            // test exists to catch.
            const sk = String(items[0].Put!.Item.SK);
            const guarded = items[0].Put!.ConditionExpression === 'attribute_not_exists(PK)';
            if (guarded && storedInvoices.has(sk)) {
                throw Object.assign(new Error('cancelled'), {
                    name: 'TransactionCanceledException',
                    CancellationReasons: items.map((_, i) =>
                        (i === 0 ? { Code: 'ConditionalCheckFailed' } : { Code: 'None' })),
                });
            }
            storedInvoices.add(sk);

            for (const item of items.slice(1)) {
                const u = item.Update;
                if (!u) continue;
                const key = String(u.Key.SK);
                if (!key.startsWith('BATCH#')) continue;
                batchDeltas[key] = (batchDeltas[key] ?? 0) + Number(u.ExpressionAttributeValues![':delta']);
            }
            return {};
        }

        if (name === 'GetCommand') return { Item: { quantity: 3 } };
        return {};
    };

    return { send, calls, batchDeltas, transactions, seqUsed: () => seq };
};

const ids = () => {
    let n = 0;
    return () => `mv_${++n}`;
};

const create = (body: unknown, world = makeWorld(), over: Record<string, unknown> = {}) =>
    createInvoice({
        uid: UID, body, finalize: true, timeZone: 'Asia/Kolkata',
        now: NOW, today: TODAY, newId: ids(), send: world.send, ...over,
    });

const SALE_BODY = {
    id: 'inv_abc', type: 'SALE', tier: 25, partyName: 'Priya Sharma',
    lines: [{ productId: 'p_1', expiryDate: '2026-11-15', quantity: 2 }],
};

const body = <T extends Record<string, unknown>>(res: { body: string }): T =>
    JSON.parse(res.body) as T;

// ── Counter ordering ────────────────────────────────────────────────────────

describe('invoice number is reserved BEFORE the transaction', () => {
    it('reserves the number, then commits — in that order', async () => {
        const world = makeWorld();
        await create(SALE_BODY, world);

        // Load, reserve, commit — in that order. (A SALE decrements, so a
        // recompute Query + Update follow the transaction; the first three calls
        // are the ones this property is about.)
        expect(world.calls.slice(0, 3)).toEqual(['BatchGetCommand', 'UpdateCommand', 'TransactWriteCommand']);
        expect(world.calls.indexOf('UpdateCommand'))
            .toBeLessThan(world.calls.indexOf('TransactWriteCommand'));
    });

    it('does NOT put the counter inside the transaction', async () => {
        // The distinction that matters: `ADD seq :1` has to RETURN the new value
        // to build the number the invoice carries, and a transaction returns no
        // attributes. If a counter update ever appears here, numbering silently
        // stopped being atomic.
        const world = makeWorld();
        await create(SALE_BODY, world);

        const sks = world.transactions[0].map(i =>
            String(i.Put?.Item?.SK ?? i.Update?.Key?.SK ?? ''));
        expect(sks.some(sk => sk.startsWith('COUNTER#'))).toBe(false);
    });

    it('reads the catalogue before spending a number, so an unknown product burns none', async () => {
        const world = makeWorld();
        const res = await create({ ...SALE_BODY, lines: [
            { productId: 'p_missing', expiryDate: '2026-11-15', quantity: 1 },
        ] }, world);

        expect(res.statusCode).toBe(400);
        expect(body(res).error).toBe('VALIDATION');
        expect(world.calls).toEqual(['BatchGetCommand']);   // no counter, no transaction
        expect(world.seqUsed()).toBe(0);
    });

    it('burns the number when the transaction fails — gaps are by design', async () => {
        const world = makeWorld();
        await create(SALE_BODY, world);                       // takes 0001
        const dup = await create(SALE_BODY, world);           // same id: cancelled
        expect(dup.statusCode).toBe(409);

        // The retry still consumed a number. That is the documented trade
        // (TRD §5): a skipped number beats a reused one.
        expect(world.seqUsed()).toBe(2);

        const next = await create({ ...SALE_BODY, id: 'inv_next' }, world);
        expect(body<Invoice>(next).invoiceNo).toBe('INV-2026-0003');
    });
});

describe('formatInvoiceNo', () => {
    it('pads to four digits, per type', () => {
        expect(formatInvoiceNo('SALE', 2026, 1)).toBe('INV-2026-0001');
        expect(formatInvoiceNo('PURCHASE', 2026, 7)).toBe('PUR-2026-0007');
        expect(formatInvoiceNo('SALE', 2026, 1234)).toBe('INV-2026-1234');
    });

    it('does not truncate once the sequence outgrows the padding', () => {
        expect(formatInvoiceNo('SALE', 2026, 12345)).toBe('INV-2026-12345');
    });
});

describe('reserveInvoiceNo — yearly reset', () => {
    interface UpdateInput {
        UpdateExpression?: string;
        ConditionExpression?: string;
        ExpressionAttributeNames?: Record<string, string>;
        ExpressionAttributeValues?: Record<string, unknown>;
    }

    const recorder = (behaviour: (n: number, input: UpdateInput) => unknown) => {
        const inputs: UpdateInput[] = [];
        let n = 0;
        const send: Send = async (command: unknown) => {
            const c = command as { input: UpdateInput };
            inputs.push(c.input);
            n += 1;
            const out = behaviour(n, c.input);
            if (out instanceof Error) throw out;
            return out as Record<string, unknown>;
        };
        return { send, inputs };
    };

    const conditionalFailure = () =>
        Object.assign(new Error('condition failed'), { name: 'ConditionalCheckFailedException' });

    it('increments with ADD while the stored year matches', async () => {
        const { send, inputs } = recorder(() => ({ Attributes: { seq: 8 } }));
        expect(await reserveInvoiceNo(UID, 'SALE', 2026, send)).toEqual({ seq: 8, year: 2026 });
        expect(inputs[0].UpdateExpression).toBe('ADD #seq :one SET #year = :year');
        expect(inputs[0].ConditionExpression).toBe('attribute_not_exists(#year) OR #year = :year');
    });

    it('resets to 1 when the stored year is stale', async () => {
        const { send, inputs } = recorder(n =>
            (n === 1 ? conditionalFailure() : { Attributes: { seq: 1 } }));

        expect(await reserveInvoiceNo(UID, 'SALE', 2027, send)).toEqual({ seq: 1, year: 2027 });
        expect(inputs[1].UpdateExpression).toBe('SET #seq = :one, #year = :year');
        expect(inputs[1].ConditionExpression).toBe('#year <> :year');
    });

    it('falls back to ADD when a concurrent caller wins the reset', async () => {
        // Both see a stale year; the other resets first, so this one's guarded
        // reset fails and it must take a number from the counter they created —
        // not reset again, which would hand out 1 twice.
        const { send } = recorder(n => {
            if (n === 1) return conditionalFailure();   // ADD  — year stale
            if (n === 2) return conditionalFailure();   // SET  — someone else reset
            return { Attributes: { seq: 2 } };          // ADD  — against their reset
        });
        expect(await reserveInvoiceNo(UID, 'SALE', 2027, send)).toEqual({ seq: 2, year: 2027 });
    });

    it('aliases both reserved-ish names', async () => {
        const { send, inputs } = recorder(() => ({ Attributes: { seq: 1 } }));
        await reserveInvoiceNo(UID, 'SALE', 2026, send);
        expect(inputs[0].ExpressionAttributeNames).toEqual({ '#seq': 'seq', '#year': 'year' });
    });
});

// ── Idempotency ─────────────────────────────────────────────────────────────

describe('idempotency — a retried submit never deducts twice', () => {
    it('answers 409 DUPLICATE on the second submit of one id', async () => {
        const world = makeWorld();
        const first  = await create(SALE_BODY, world);
        const second = await create(SALE_BODY, world);

        expect(first.statusCode).toBe(201);
        expect(second.statusCode).toBe(409);
        expect(body(second).error).toBe('DUPLICATE');
        expect(body(second).id).toBe('inv_abc');
    });

    it('deducts the stock ONCE, not twice', async () => {
        const world = makeWorld();
        await create(SALE_BODY, world);
        expect(world.batchDeltas['BATCH#p_1#2026-11-15']).toBe(-2);

        await create(SALE_BODY, world);
        expect(world.batchDeltas['BATCH#p_1#2026-11-15']).toBe(-2);   // unchanged
    });

    it('puts the invoice FIRST so reason[0] is unambiguously the id guard', async () => {
        const world = makeWorld();
        await create(SALE_BODY, world);
        const first = world.transactions[0][0];
        expect(String(first.Put.Item.SK)).toBe('INVOICE#inv_abc');
        expect(first.Put.ConditionExpression).toBe('attribute_not_exists(PK)');
    });
});

// ── Line cap ────────────────────────────────────────────────────────────────

describe('line cap', () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => ({
        productId: 'p_1', expiryDate: `2027-01-${String((i % 28) + 1).padStart(2, '0')}`, quantity: 1,
    }));

    it('rejects 31 lines with TOO_MANY_LINES', async () => {
        const res = await create({ ...SALE_BODY, lines: lines(31) });
        expect(res.statusCode).toBe(400);
        expect(body(res)).toMatchObject({
            error: 'TOO_MANY_LINES', limit: MAX_INVOICE_LINES, received: 31,
        });
    });

    it('rejects before touching DynamoDB at all — no number burned', async () => {
        const world = makeWorld();
        await create({ ...SALE_BODY, lines: lines(31) }, world);
        expect(world.calls).toEqual([]);
        expect(world.seqUsed()).toBe(0);
    });

    it('accepts exactly 30', async () => {
        const res = await create({ ...SALE_BODY, lines: lines(30) });
        expect(res.statusCode).toBe(201);
        expect(body<Invoice>(res).lines).toHaveLength(30);
    });
});

// ── Purchase line merging ───────────────────────────────────────────────────

describe('mergePurchaseLines', () => {
    it('sums duplicate (productId, expiryDate) lines', () => {
        expect(mergePurchaseLines([
            { productId: 'p_1', expiryDate: '2027-06-30', quantity: 12 },
            { productId: 'p_1', expiryDate: '2027-06-30', quantity: 6 },
        ])).toEqual([{ productId: 'p_1', expiryDate: '2027-06-30', quantity: 18 }]);
    });

    it('keeps different expiries of one product apart — they are different lots', () => {
        expect(mergePurchaseLines([
            { productId: 'p_1', expiryDate: '2027-06-30', quantity: 12 },
            { productId: 'p_1', expiryDate: '2027-01-20', quantity: 6 },
        ])).toHaveLength(2);
    });

    it('preserves first-seen order', () => {
        const merged = mergePurchaseLines([
            { productId: 'p_2', expiryDate: '2027-03-15', quantity: 1 },
            { productId: 'p_1', expiryDate: '2027-06-30', quantity: 2 },
            { productId: 'p_2', expiryDate: '2027-03-15', quantity: 3 },
        ]);
        expect(merged.map(l => l.productId)).toEqual(['p_2', 'p_1']);
        expect(merged[0].quantity).toBe(4);
    });

    it('does not mutate its input', () => {
        const input = [
            { productId: 'p_1', expiryDate: '2027-06-30', quantity: 12 },
            { productId: 'p_1', expiryDate: '2027-06-30', quantity: 6 },
        ];
        mergePurchaseLines(input);
        expect(input[0].quantity).toBe(12);
    });
});

describe('PURCHASE merges duplicate lines end to end', () => {
    const PURCHASE_BODY = {
        id: 'pur_1', type: 'PURCHASE', partyName: 'Herbalife India Pvt. Ltd.',
        lines: [
            { productId: 'p_1', expiryDate: '2027-06-30', quantity: 12 },
            { productId: 'p_1', expiryDate: '2027-06-30', quantity: 6 },
        ],
    };

    it('stores ONE line carrying the summed quantity', async () => {
        const invoice = body<Invoice>(await create(PURCHASE_BODY));
        expect(invoice.lines).toHaveLength(1);
        expect(invoice.lines[0].quantity).toBe(18);
        expect(invoice.lines[0].lineAmount).toBe(18 * 1246);
    });

    it('writes ONE movement, because there is now only one line', async () => {
        // This is the merge's own fingerprint. The BATCH update would collapse
        // to one either way — `applyStockChange` aggregates per (product,
        // expiry) regardless — so counting batch writes proves the engine
        // works, not that the merge ran. Movements are per LINE, so they are
        // what actually distinguishes a merged invoice from an unmerged one.
        const world = makeWorld();
        await create(PURCHASE_BODY, world);

        const movements = world.transactions[0]
            .filter(i => String(i.Put?.Item?.SK ?? '').startsWith('STOCKMOVE#'));
        expect(movements).toHaveLength(1);
        expect(movements[0].Put.Item.quantity).toBe(18);
    });

    it('still collapses to a single batch write', async () => {
        const world = makeWorld();
        await create(PURCHASE_BODY, world);

        const batchUpdates = world.transactions[0]
            .filter(i => String(i.Update?.Key?.SK ?? '').startsWith('BATCH#'));
        expect(batchUpdates).toHaveLength(1);
        expect(world.batchDeltas['BATCH#p_1#2027-06-30']).toBe(18);
    });

    it('leaves SALE lines unmerged — two picks from one lot are two movements', async () => {
        const world = makeWorld();
        const invoice = body<Invoice>(await create({
            ...SALE_BODY,
            lines: [
                { productId: 'p_1', expiryDate: '2026-11-15', quantity: 2 },
                { productId: 'p_1', expiryDate: '2026-11-15', quantity: 1 },
            ],
        }, world));

        expect(invoice.lines).toHaveLength(2);
        const movements = world.transactions[0]
            .filter(i => String(i.Put?.Item?.SK ?? '').startsWith('STOCKMOVE#'));
        expect(movements).toHaveLength(2);
        // ...but still ONE batch write, aggregated by the engine.
        expect(world.batchDeltas['BATCH#p_1#2026-11-15']).toBe(-3);
    });
});

// ── Prices come from the catalogue, never the client ────────────────────────

describe('client-sent prices are ignored', () => {
    const HOSTILE = {
        id: 'inv_h', type: 'SALE', tier: 25, partyName: 'Priya Sharma',
        // Everything below is a lie the server must overwrite.
        invoiceNo: 'INV-9999-9999',
        status: 'Cancelled',
        stockApplied: false,
        totalAmount: 1,
        totalVp: 999,
        totalCost: 0,
        createdAt: '2000-01-01T00:00:00.000Z',
        lines: [{
            productId: 'p_1', expiryDate: '2026-11-15', quantity: 2,
            unitPrice: 1, unitVp: 0, lineAmount: 1, lineVp: 0,
            name: 'Free Stuff', stockNo: 'HACK', unitCost: 0,
        }],
    };

    it('prices the line from the catalogue at the requested tier', async () => {
        const line = body<Invoice>(await create(HOSTILE)).lines[0];
        expect(line.unitPrice).toBe(1713);          // price25, not the 1 sent
        expect(line.lineAmount).toBe(3426);         // 1713 x 2
        expect(line.unitVp).toBe(21.75);
        expect(line.lineVp).toBe(43.5);
    });

    it('snapshots name and stockNo from the catalogue, not the request', async () => {
        const line = body<Invoice>(await create(HOSTILE)).lines[0];
        expect(line.name).toBe('Formula 1 - Strawberry');
        expect(line.stockNo).toBe('1239');
    });

    it('recomputes the totals', async () => {
        const invoice = body<Invoice>(await create(HOSTILE));
        expect(invoice.totalAmount).toBe(3426);
        expect(invoice.totalVp).toBe(43.5);
        expect(invoice.totalCost).toBe(2492);       // price50 x 2 — internal
    });

    it('overrides invoiceNo, status, stockApplied and createdAt', async () => {
        const invoice = body<Invoice>(await create(HOSTILE));
        expect(invoice.invoiceNo).toBe('INV-2026-0001');
        expect(invoice.status).toBe('Finalized');
        expect(invoice.stockApplied).toBe(true);
        expect(invoice.createdAt).toBe(NOW);
    });

    it('cannot be steered into another user\'s partition via PK/SK', async () => {
        const world = makeWorld();
        await create({ ...SALE_BODY, PK: 'USER#someone_else', SK: 'INVOICE#evil' }, world);
        expect(world.transactions[0][0].Put.Item).toMatchObject({
            PK: `USER#${UID}`, SK: 'INVOICE#inv_abc',
        });
    });
});

describe('pricing across tiers', () => {
    const at = (tier: number) => priceInvoice({
        request: {
            id: 'x', type: 'SALE', tier: tier as 0 | 25 | 35 | 42 | 50, partyName: 'P',
            lines: [{ productId: 'p_1', expiryDate: '2026-11-15', quantity: 1 }],
        },
        products: CATALOGUE, invoiceNo: 'INV-2026-0001', date: TODAY, now: NOW, finalize: true,
    });

    it('maps each tier to its catalogue field — 0% is Retail, not MRP', () => {
        expect(at(0).lines[0].unitPrice).toBe(2075);
        expect(at(25).lines[0].unitPrice).toBe(1713);
        expect(at(35).lines[0].unitPrice).toBe(1526);
        expect(at(42).lines[0].unitPrice).toBe(1396);
        expect(at(50).lines[0].unitPrice).toBe(1246);
    });

    it('never changes VP with the tier', () => {
        for (const tier of [0, 25, 35, 42, 50]) {
            expect(at(tier).lines[0].unitVp).toBe(21.75);
        }
    });

    it('rounds the VP total ONCE, not per line', () => {
        // Three lines of 21.75 raw = 65.25. Rounding each first would still give
        // 65.25 here, so use a product whose per-line VP does not terminate:
        // 0.1 x 3 = 0.30000000000000004 raw, which must land on 0.3.
        const drifty = priceInvoice({
            request: {
                id: 'x', type: 'SALE', tier: 25, partyName: 'P',
                lines: [
                    { productId: 'p_d', expiryDate: '2026-11-15', quantity: 1 },
                    { productId: 'p_d', expiryDate: '2026-12-15', quantity: 1 },
                    { productId: 'p_d', expiryDate: '2027-01-15', quantity: 1 },
                ],
            },
            products: { p_d: { ...CATALOGUE.p_1, id: 'p_d', vp: 0.1 } },
            invoiceNo: 'INV-2026-0001', date: TODAY, now: NOW, finalize: true,
        });
        expect(drifty.totalVp).toBe(0.3);
    });

    it('omits unitCost and totalCost on a PURCHASE — unitPrice already IS the cost', () => {
        const purchase = priceInvoice({
            request: {
                id: 'x', type: 'PURCHASE', tier: 50, partyName: 'S',
                lines: [{ productId: 'p_1', expiryDate: '2027-06-30', quantity: 12 }],
            },
            products: CATALOGUE, invoiceNo: 'PUR-2026-0001', date: TODAY, now: NOW, finalize: true,
        });
        expect(purchase.lines[0].unitCost).toBeUndefined();
        expect(purchase.totalCost).toBeUndefined();
        expect(purchase.lines[0].unitPrice).toBe(1246);
    });
});

// ── Body validation ─────────────────────────────────────────────────────────

describe('validateCreateBody', () => {
    const ok = (over: Record<string, unknown> = {}) => validateCreateBody({ ...SALE_BODY, ...over });

    it('forces a PURCHASE to tier 50 regardless of what was asked for', () => {
        const parsed = validateCreateBody({
            type: 'PURCHASE', tier: 0, partyName: 'S',
            lines: [{ productId: 'p_1', expiryDate: '2027-06-30', quantity: 1 }],
        });
        expect('value' in parsed && parsed.value.tier).toBe(50);
    });

    it('rejects an unknown tier on a SALE', () => {
        expect('error' in ok({ tier: 30 })).toBe(true);
    });

    it('requires a party name', () => {
        expect('error' in ok({ partyName: '   ' })).toBe(true);
    });

    it('requires at least one line', () => {
        expect('error' in ok({ lines: [] })).toBe(true);
    });

    it('rejects a non-calendar expiry', () => {
        expect('error' in ok({ lines: [{ productId: 'p_1', expiryDate: '2026-02-30', quantity: 1 }] }))
            .toBe(true);
    });

    it('rejects zero, negative and fractional quantities', () => {
        for (const quantity of [0, -1, 1.5]) {
            expect('error' in ok({ lines: [{ productId: 'p_1', expiryDate: '2026-11-15', quantity }] }))
                .toBe(true);
        }
    });

    it('generates an id when the client omits one, forfeiting idempotency only', () => {
        const parsed = validateCreateBody({ ...SALE_BODY, id: undefined });
        expect('value' in parsed && parsed.value.id).toMatch(/[0-9a-f-]{36}/);
    });
});

// ── Draft ───────────────────────────────────────────────────────────────────

describe('finalize=false creates a Draft', () => {
    it('stores it as a Draft that has not moved stock', async () => {
        const invoice = body<Invoice>(await create(SALE_BODY, makeWorld(), { finalize: false }));
        expect(invoice.status).toBe('Draft');
        expect(invoice.stockApplied).toBe(false);
    });

    it('writes only the invoice — no batches, no movements', async () => {
        const world = makeWorld();
        await create(SALE_BODY, world, { finalize: false });
        expect(world.transactions[0]).toHaveLength(1);
        expect(world.batchDeltas).toEqual({});
    });

    it('still takes an invoice number, so a draft keeps its identity', async () => {
        const world = makeWorld();
        const invoice = body<Invoice>(await create(SALE_BODY, world, { finalize: false }));
        expect(invoice.invoiceNo).toBe('INV-2026-0001');
    });
});

// ── GSI6 ────────────────────────────────────────────────────────────────────

describe('GSI6-InventoryDate', () => {
    it('writes invDate = createdAt so listing is newest-first by key', async () => {
        const invoice = body<Invoice>(await create(SALE_BODY));
        expect(invoice.invDate).toBe(NOW);
        expect(invoice.invDate).toBe(invoice.createdAt);
    });

    it('keys the invoice by id alone, for point reads', async () => {
        const world = makeWorld();
        await create(SALE_BODY, world);
        expect(String(world.transactions[0][0].Put.Item.SK)).toBe('INVOICE#inv_abc');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Item 3 — read / list / update / finalize / cancel / delete
//
// These need STATE the item-2 fake does not model: a GET must return what was
// stored, finalize must re-read a draft, cancel must reverse a finalized
// invoice's stock, and a status guard must actually reject. So they run against
// `makeStore` — a small stateful table that honours ConditionExpressions and
// accumulates batch quantities, which is what makes the guards testable rather
// than assumed.
// ═══════════════════════════════════════════════════════════════════════════

const PK = `USER#${UID}`;

interface Row { PK: string; SK: string; [k: string]: unknown }

/**
 * Evaluate the SPECIFIC condition-expression forms this handler emits.
 *
 * Not a general DynamoDB expression engine — it covers exactly the operators in
 * use (`attribute_exists`, `attribute_not_exists`, `=`, `<>`, `>=`) so a guard
 * that would fire against real DynamoDB fires here too, and throws on anything
 * unrecognised so a new guard can never pass silently untested.
 */
const evalCondition = (
    expr: string | undefined,
    names: Record<string, string> = {},
    values: Record<string, unknown> = {},
    item: Row | undefined,
): boolean => {
    if (!expr) return true;
    const nameOf = (t: string) => (t.startsWith('#') ? names[t] : t);
    const present = (t: string) => item !== undefined && item[nameOf(t)] !== undefined;

    return expr.split(' AND ').every(rawTerm => {
        const term = rawTerm.trim();
        if (term.includes(' OR ')) {
            return term.split(' OR ').some(sub => evalCondition(sub.trim(), names, values, item));
        }
        let m: RegExpExecArray | null;
        if ((m = /^attribute_not_exists\((.+)\)$/.exec(term))) return !present(m[1]);
        if ((m = /^attribute_exists\((.+)\)$/.exec(term)))     return present(m[1]);
        if ((m = /^(#?\w+)\s*(=|<>|>=|<=|>|<)\s*(:\w+)$/.exec(term))) {
            const left  = item?.[nameOf(m[1])];
            const right = values[m[3]];
            switch (m[2]) {
                case '=':  return left === right;
                case '<>': return left !== right;
                case '>=': return Number(left) >= Number(right);
                case '<=': return Number(left) <= Number(right);
                case '>':  return Number(left) >  Number(right);
                case '<':  return Number(left) <  Number(right);
            }
        }
        throw new Error(`makeStore: unhandled condition term "${term}"`);
    });
};

interface StoreOptions {
    catalogue?: Record<string, CatalogueProduct>;
    invoices?: Invoice[];
    /** Seed batch stock, keyed `productId#expiry`, e.g. { 'p_1#2026-11-15': 10 }. */
    batches?: Record<string, number>;
    /** Seed PRODUCT# roll-up rows, so a stale earliestExpiry can be observed. */
    products?: Record<string, { earliestExpiry?: string; totalQuantity?: number }>;
    seqStart?: number;
}

const makeStore = (opts: StoreOptions = {}) => {
    const catalogue = opts.catalogue ?? CATALOGUE;
    const rows = new Map<string, Row>();
    const calls: string[] = [];
    let seq = opts.seqStart ?? 0;

    for (const inv of opts.invoices ?? []) {
        rows.set(`INVOICE#${inv.id}`, { PK, SK: `INVOICE#${inv.id}`, ...inv });
    }
    for (const [id, p] of Object.entries(opts.products ?? {})) {
        rows.set(`PRODUCT#${id}`, { PK, SK: `PRODUCT#${id}`, id, ...p });
    }
    // Batches carry `invDate = expiryDate` because they SHARE GSI6 with invoices
    // — that shared index is the whole reason the list endpoint has to work
    // around batch rows, so the fake has to model it.
    for (const [k, quantity] of Object.entries(opts.batches ?? {})) {
        const expiry = k.split('#')[1];
        rows.set(`BATCH#${k}`, { PK, SK: `BATCH#${k}`, quantity, expiryDate: expiry, invDate: expiry });
    }

    const cancelled = (items: TransactItemShape[], reasons: { Code: string }[]) =>
        Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException', CancellationReasons: reasons });

    const applyUpdate = (u: NonNullable<TransactItemShape['Update']>) => {
        const sk = String(u.Key.SK);
        const delta = Number(u.ExpressionAttributeValues?.[':delta'] ?? 0);
        const existing = rows.get(sk) ?? { PK, SK: sk, quantity: 0 };
        if (sk.startsWith('BATCH#')) {
            existing.quantity   = Number(existing.quantity ?? 0) + delta;
            const expiry        = sk.split('#')[2];
            existing.expiryDate = expiry;
            existing.invDate    = expiry;      // keep the shared-index key populated
        }
        if (sk.startsWith('PRODUCT#')) existing.totalQuantity = Number(existing.totalQuantity ?? 0) + delta;
        rows.set(sk, existing);
    };

    const send: Send = async (command: unknown) => {
        const c = command as unknown as { constructor: { name: string }; input: StoreCommandInput };
        const name = c.constructor.name;
        calls.push(name);

        if (name === 'GetCommand') {
            return { Item: rows.get(String(c.input.Key!.SK)) };
        }

        if (name === 'BatchGetCommand') {
            const asked = c.input.RequestItems![TABLE].Keys;
            const items = asked
                .map(k => catalogue[String(k.SK).replace('PRODUCT#', '')])
                .filter(Boolean);
            return { Responses: { [TABLE]: items } };
        }

        if (name === 'UpdateCommand') {
            const sk = String(c.input.Key!.SK);
            // The invoice-number counter.
            if (sk.startsWith('COUNTER#')) { seq += 1; return { Attributes: { seq } }; }
            // The post-transaction earliestExpiry recompute (upsert on PRODUCT#).
            const row  = rows.get(sk) ?? { PK, SK: sk };
            const expr = c.input.UpdateExpression ?? '';
            const vals = c.input.ExpressionAttributeValues ?? {};
            if (/REMOVE\s+earliestExpiry/.test(expr))          delete row.earliestExpiry;
            if (/SET[\s\S]*earliestExpiry\s*=\s*:e/.test(expr)) row.earliestExpiry = vals[':e'];
            rows.set(sk, row);
            return {};
        }

        if (name === 'PutCommand') {
            const item = c.input.Item as Row;
            if (!evalCondition(c.input.ConditionExpression, c.input.ExpressionAttributeNames,
                               c.input.ExpressionAttributeValues, rows.get(String(item.SK)))) {
                throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
            }
            rows.set(String(item.SK), item);
            return {};
        }

        if (name === 'DeleteCommand') {
            const sk = String(c.input.Key!.SK);
            if (!evalCondition(c.input.ConditionExpression, c.input.ExpressionAttributeNames,
                               c.input.ExpressionAttributeValues, rows.get(sk))) {
                throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
            }
            rows.delete(sk);
            return {};
        }

        if (name === 'TransactWriteCommand') {
            interface GuardedOp {
                ConditionExpression?: string;
                ExpressionAttributeNames?: Record<string, string>;
                ExpressionAttributeValues?: Record<string, unknown>;
            }
            const items = c.input.TransactItems as (TransactItemShape & {
                Put?:    { Item: Row } & GuardedOp;
                Update?: NonNullable<TransactItemShape['Update']> & GuardedOp;
            })[];

            // Phase 1 — check EVERY condition against current state.
            const reasons = items.map(ti => {
                const op: GuardedOp | undefined = ti.Put ?? ti.Update;
                const key = String((ti.Put?.Item.SK ?? ti.Update?.Key.SK) ?? '');
                const ok  = evalCondition(op?.ConditionExpression, op?.ExpressionAttributeNames,
                                          op?.ExpressionAttributeValues, rows.get(key));
                return { Code: ok ? 'None' : 'ConditionalCheckFailed' };
            });
            if (reasons.some(r => r.Code === 'ConditionalCheckFailed')) throw cancelled(items, reasons);

            // Phase 2 — apply.
            for (const ti of items) {
                if (ti.Put)    rows.set(String(ti.Put.Item.SK), ti.Put.Item);
                if (ti.Update) applyUpdate(ti.Update);
            }
            return {};
        }

        if (name === 'QueryCommand') {
            const v = (c.input.ExpressionAttributeValues ?? {}) as Record<string, string>;

            // Base-table query (no IndexName) — the recompute reading a product's
            // batches by `begins_with(SK, 'BATCH#<pid>#')`.
            if (!c.input.IndexName) {
                const prefix = v[':prefix'] ?? '';
                return { Items: [...rows.values()].filter(r => String(r.SK).startsWith(prefix)) };
            }

            // GSI6 index scan (invoice list). Models the property that breaks a
            // naive list: EVERY row with an invDate is in the index — invoices
            // AND batches — and `Limit` counts rows READ, before the filter.
            let idx = [...rows.values()].filter(r => r.invDate !== undefined);
            if (v[':from']) idx = idx.filter(r => String(r.invDate) >= v[':from']);
            if (v[':to'])   idx = idx.filter(r => String(r.invDate) <= v[':to']);

            const forward = c.input.ScanIndexForward !== false;
            // Sort by (invDate, SK) — the index order — honouring ScanIndexForward.
            const cmp = (a: Row, b: Row) => {
                const d = String(a.invDate).localeCompare(String(b.invDate));
                return d !== 0 ? d : String(a.SK).localeCompare(String(b.SK));
            };
            idx.sort((a, b) => (forward ? 1 : -1) * cmp(a, b));

            const cursor = c.input.ExclusiveStartKey as Row | undefined;
            if (cursor) idx = idx.filter(r => (forward ? cmp(r, cursor) > 0 : cmp(r, cursor) < 0));

            // Limit applies to rows READ from the index, BEFORE the filter runs.
            const limit = Number(c.input.Limit ?? 50);
            const read  = idx.slice(0, limit);
            const more  = idx.length > read.length;

            // Now the FilterExpression: begins_with(SK, :prefix) + type/status.
            let out = read.filter(r => String(r.SK).startsWith(v[':prefix'] ?? ''));
            if (v[':type'])   out = out.filter(r => r.type === v[':type']);
            if (v[':status']) out = out.filter(r => r.status === v[':status']);

            const lastRead = read[read.length - 1];
            const LastEvaluatedKey = more && lastRead
                ? { PK: lastRead.PK, SK: lastRead.SK, invDate: lastRead.invDate }
                : undefined;
            return { Items: out, LastEvaluatedKey };
        }

        return {};
    };

    return {
        send, calls,
        invoice: (id: string) => rows.get(`INVOICE#${id}`) as Invoice | undefined,
        product: (id: string) => rows.get(`PRODUCT#${id}`),
        batchQty: (k: string) => Number(rows.get(`BATCH#${k}`)?.quantity ?? 0),
        /** Stand in for a rival request committing between our read and our write. */
        simulateConcurrentWrite: (id: string, patch: Partial<Invoice>) => {
            const row = rows.get(`INVOICE#${id}`);
            if (row) Object.assign(row, patch);
        },
    };
};

/** A stored invoice, defaulted to a finalized SALE of 2 units. */
const storedInvoice = (over: Partial<Invoice> = {}): Invoice => ({
    id: 'inv_1', type: 'SALE', invoiceNo: 'INV-2026-0001', date: TODAY, tier: 25,
    partyName: 'Priya Sharma',
    lines: [{
        productId: 'p_1', stockNo: '1239', name: 'Formula 1 - Strawberry',
        unitPrice: 1713, unitVp: 21.75, quantity: 2, lineAmount: 3426, lineVp: 43.5,
        expiryDate: '2026-11-15', unitCost: 1246,
    }],
    totalAmount: 3426, totalVp: 43.5, totalCost: 2492,
    status: 'Finalized', stockApplied: true,
    invDate: NOW, createdAt: NOW,
    ...over,
});

const mutate = (store: ReturnType<typeof makeStore>, id: string) =>
    ({ uid: UID, id, now: NOW, newId: ids(), send: store.send });

// ── GET /invoices/{id} ──────────────────────────────────────────────────────

describe('GET /invoices/{id}', () => {
    it('returns the stored invoice without table keys', async () => {
        const store = makeStore({ invoices: [storedInvoice()] });
        const res = await getInvoice(UID, 'inv_1', store.send);
        expect(res.statusCode).toBe(200);
        const inv = body<Invoice>(res);
        expect(inv.id).toBe('inv_1');
        expect(inv.PK).toBeUndefined();
        expect(inv.SK).toBeUndefined();
    });

    it('404s with a coded error when the id is unknown', async () => {
        const store = makeStore();
        const res = await getInvoice(UID, 'nope', store.send);
        expect(res.statusCode).toBe(404);
        expect(body(res)).toMatchObject({ error: 'NOT_FOUND', id: 'nope' });
    });
});

// ── GET /invoices (list) ────────────────────────────────────────────────────

const listReq = (query: Record<string, string> = {}) =>
    ({ queryStringParameters: query } as unknown as APIGatewayProxyEvent);

describe('GET /invoices', () => {
    const three = [
        storedInvoice({ id: 'a', invDate: '2026-07-21T10:00:00.000Z', type: 'SALE' }),
        storedInvoice({ id: 'b', invDate: '2026-07-22T10:00:00.000Z', type: 'PURCHASE' }),
        storedInvoice({ id: 'c', invDate: '2026-07-23T10:00:00.000Z', type: 'SALE' }),
    ];

    it('returns newest-first by invDate', async () => {
        const store = makeStore({ invoices: three });
        const res = await listInvoices({ uid: UID, event: listReq(), send: store.send });
        expect(body<{ invoices: Invoice[] }>(res).invoices.map(i => i.id)).toEqual(['c', 'b', 'a']);
    });

    it('nextToken is null, not undefined, on the last page', async () => {
        const store = makeStore({ invoices: three });
        const parsed = body<{ nextToken: unknown }>(await listInvoices({
            uid: UID, event: listReq(), send: store.send,
        }));
        expect(parsed.nextToken).toBeNull();
        expect('nextToken' in parsed).toBe(true);          // present, not merely undefined
    });

    it('round-trips nextToken as base64 across pages', async () => {
        const store = makeStore({ invoices: three });
        const page1 = body<{ invoices: Invoice[]; nextToken: string }>(await listInvoices({
            uid: UID, event: listReq({ limit: '2' }), send: store.send,
        }));
        expect(page1.invoices.map(i => i.id)).toEqual(['c', 'b']);
        expect(page1.nextToken).toEqual(expect.any(String));
        // The token decodes to a real key — not an opaque string that only looks base64.
        expect(() => JSON.parse(Buffer.from(page1.nextToken, 'base64').toString())).not.toThrow();

        const page2 = body<{ invoices: Invoice[]; nextToken: unknown }>(await listInvoices({
            uid: UID, event: listReq({ limit: '2', nextToken: page1.nextToken }), send: store.send,
        }));
        expect(page2.invoices.map(i => i.id)).toEqual(['a']);
        expect(page2.nextToken).toBeNull();
    });

    it('filters by type', async () => {
        const store = makeStore({ invoices: three });
        const res = await listInvoices({ uid: UID, event: listReq({ type: 'SALE' }), send: store.send });
        expect(body<{ invoices: Invoice[] }>(res).invoices.map(i => i.id)).toEqual(['c', 'a']);
    });

    const five = Array.from({ length: 5 }, (_, i) =>
        storedInvoice({ id: `n${i}`, invDate: `2026-07-2${i}T10:00:00.000Z` }));

    it('clamps the page size to the 1..200 band', async () => {
        // Assert via the returned count: a hostile limit is clamped, an explicit
        // 0 clamps to the floor of 1 (not folded into the default 50).
        const store = makeStore({ invoices: five });
        const big = body<{ invoices: Invoice[] }>(await listInvoices({
            uid: UID, event: listReq({ limit: '99999' }), send: store.send }));
        expect(big.invoices).toHaveLength(5);                 // 200-clamp >= all 5

        const zero = body<{ invoices: Invoice[] }>(await listInvoices({
            uid: UID, event: listReq({ limit: '0' }), send: store.send }));
        expect(zero.invoices).toHaveLength(1);                // floored to 1, not 50
    });

    it('returns invoices even when batches crowd the front of the shared index', async () => {
        // THE bug the first live run exposed. Batches share GSI6 and their future
        // expiry dates sort lexically ABOVE recent invoice timestamps, so a naive
        // Limit=pageSize query reads only batch rows and returns an empty page.
        // Six batches dated 2027/2028 sit ahead of three 2026-07 invoices.
        const batches: Record<string, number> = {
            'p_1#2028-06-30': 5, 'p_1#2028-03-31': 5, 'p_1#2027-12-01': 5,
            'p_1#2027-09-01': 5, 'p_1#2027-06-01': 5, 'p_1#2027-03-01': 5,
        };
        const store = makeStore({ invoices: three, batches });

        // A SINGLE call (pageSize 2) must surface real invoices, newest-first —
        // not an empty page with a token.
        const page = body<{ invoices: Invoice[]; nextToken: unknown }>(await listInvoices({
            uid: UID, event: listReq({ limit: '2' }), send: store.send }));
        expect(page.invoices.map(i => i.id)).toEqual(['c', 'b']);
        expect(page.nextToken).toEqual(expect.any(String));

        const rest = body<{ invoices: Invoice[]; nextToken: unknown }>(await listInvoices({
            uid: UID, event: listReq({ limit: '2', nextToken: page.nextToken }), send: store.send }));
        expect(rest.invoices.map(i => i.id)).toEqual(['a']);
        expect(rest.nextToken).toBeNull();
    });

    it('a status filter still finds the matching invoice behind the batch rows', async () => {
        // The single-call failure my cleanup hit: GET /invoices?status=Finalized
        // returned nothing because page 1 was all batches.
        const batches = Object.fromEntries(
            Array.from({ length: 8 }, (_, i) => [`p_1#2028-0${i + 1}-01`, 3]));
        const store = makeStore({
            invoices: [
                storedInvoice({ id: 'fin', status: 'Finalized', invDate: '2026-07-23T10:00:00.000Z' }),
                storedInvoice({ id: 'can', status: 'Cancelled', invDate: '2026-07-22T10:00:00.000Z' }),
            ],
            batches,
        });
        const res = body<{ invoices: Invoice[] }>(await listInvoices({
            uid: UID, event: listReq({ status: 'Finalized' }), send: store.send }));
        expect(res.invoices.map(i => i.id)).toEqual(['fin']);
    });

    it('continues across MULTIPLE index chunks to reach buried invoices', async () => {
        // Exercises the continuation LOOP, not just the filter: 210 batch rows
        // sort ahead of the invoices, so one 200-row chunk is not enough — the
        // handler must read a second chunk. A single-shot query returns empty.
        const batches: Record<string, number> = {};
        const base = Date.UTC(2027, 0, 1);
        for (let i = 0; i < 210; i++) {
            const d = new Date(base + i * 86_400_000).toISOString().slice(0, 10);   // distinct 2027 dates
            batches[`p_1#${d}`] = 3;
        }
        const store = makeStore({
            invoices: [
                storedInvoice({ id: 'x', invDate: '2026-07-23T10:00:00.000Z' }),
                storedInvoice({ id: 'y', invDate: '2026-07-22T10:00:00.000Z' }),
            ],
            batches,
        });
        const res = body<{ invoices: Invoice[] }>(await listInvoices({
            uid: UID, event: listReq(), send: store.send }));
        expect(res.invoices.map(i => i.id)).toEqual(['x', 'y']);   // found past 210 batch rows
    });
});

// ── PUT /invoices/{id} ──────────────────────────────────────────────────────

describe('PUT /invoices/{id}', () => {
    const editBody = {
        type: 'SALE', tier: 25, partyName: 'Priya Sharma',
        lines: [{ productId: 'p_1', expiryDate: '2026-11-15', quantity: 5 }],
    };

    it('re-prices a Draft from the catalogue and keeps its number', async () => {
        const store = makeStore({ invoices: [storedInvoice({ status: 'Draft', stockApplied: false })] });
        const res = await updateInvoice({ ...mutate(store, 'inv_1'), body: editBody });
        expect(res.statusCode).toBe(200);
        const inv = body<Invoice>(res);
        expect(inv.lines[0].quantity).toBe(5);
        expect(inv.lines[0].lineAmount).toBe(5 * 1713);
        expect(inv.invoiceNo).toBe('INV-2026-0001');       // unchanged
    });

    it('rejects editing a Finalized invoice with 409 NOT_DRAFT', async () => {
        const store = makeStore({ invoices: [storedInvoice({ status: 'Finalized' })] });
        const res = await updateInvoice({ ...mutate(store, 'inv_1'), body: editBody });
        expect(res.statusCode).toBe(409);
        expect(body(res)).toMatchObject({ error: 'NOT_DRAFT', status: 'Finalized' });
    });

    it('rejects editing a Cancelled invoice', async () => {
        const store = makeStore({ invoices: [storedInvoice({ status: 'Cancelled' })] });
        const res = await updateInvoice({ ...mutate(store, 'inv_1'), body: editBody });
        expect(res.statusCode).toBe(409);
        expect(body(res).error).toBe('NOT_DRAFT');
    });

    it('404s for an unknown id', async () => {
        const store = makeStore();
        const res = await updateInvoice({ ...mutate(store, 'nope'), body: editBody });
        expect(res.statusCode).toBe(404);
    });
});

// ── POST /invoices/{id}/finalize ────────────────────────────────────────────

describe('POST /invoices/{id}/finalize', () => {
    it('re-prices against the CURRENT catalogue, not the draft snapshot', async () => {
        // Draft stored when price25 was 1713; catalogue has since risen to 1800.
        const draft = storedInvoice({
            status: 'Draft', stockApplied: false,
            lines: [{
                productId: 'p_1', stockNo: '1239', name: 'Formula 1 - Strawberry',
                unitPrice: 1713, unitVp: 21.75, quantity: 2, lineAmount: 3426, lineVp: 43.5,
                expiryDate: '2026-11-15', unitCost: 1246,
            }],
            totalAmount: 3426,
        });
        const store = makeStore({
            invoices: [draft],
            batches:  { 'p_1#2026-11-15': 10 },
            catalogue: { ...CATALOGUE, p_1: { ...CATALOGUE.p_1, price25: 1800 } },
        });

        const inv = body<Invoice>(await finalizeInvoice(mutate(store, 'inv_1')));
        expect(inv.status).toBe('Finalized');
        expect(inv.lines[0].unitPrice).toBe(1800);         // re-priced, not 1713
        expect(inv.lines[0].lineAmount).toBe(3600);
        expect(inv.totalAmount).toBe(3600);
    });

    it('moves the stock it prices', async () => {
        const store = makeStore({
            invoices: [storedInvoice({ status: 'Draft', stockApplied: false })],
            batches:  { 'p_1#2026-11-15': 10 },
        });
        await finalizeInvoice(mutate(store, 'inv_1'));
        expect(store.batchQty('p_1#2026-11-15')).toBe(8);   // 10 - 2
    });

    it('re-validates stock: a draft written when stock existed 409s if the batch is now empty', async () => {
        const store = makeStore({
            invoices: [storedInvoice({ status: 'Draft', stockApplied: false })],
            batches:  { 'p_1#2026-11-15': 0 },              // emptied since the draft
        });
        const res = await finalizeInvoice(mutate(store, 'inv_1'));
        expect(res.statusCode).toBe(409);
        expect(body(res)).toMatchObject({
            error: 'INSUFFICIENT_STOCK', productId: 'p_1', expiryDate: '2026-11-15',
        });
        // The draft still exists and is untouched — nothing was half-applied.
        expect(store.invoice('inv_1')!.status).toBe('Draft');
    });

    it('rejects finalizing an already-Finalized invoice with NOT_DRAFT', async () => {
        const store = makeStore({
            invoices: [storedInvoice({ status: 'Finalized' })],
            batches:  { 'p_1#2026-11-15': 10 },
        });
        const res = await finalizeInvoice(mutate(store, 'inv_1'));
        expect(res.statusCode).toBe(409);
        expect(body(res)).toMatchObject({ error: 'NOT_DRAFT', status: 'Finalized' });
    });

    it('rejects finalizing a Cancelled invoice', async () => {
        const store = makeStore({ invoices: [storedInvoice({ status: 'Cancelled' })] });
        const res = await finalizeInvoice(mutate(store, 'inv_1'));
        expect(res.statusCode).toBe(409);
        expect(body(res).error).toBe('NOT_DRAFT');
    });
});

// ── earliestExpiry recompute after a decrement ──────────────────────────────
//
// The roll-up-integrity bug the first live run exposed: invoices moved stock
// through the engine but never ran the post-transaction recompute batches.ts
// runs, so a SALE (or a PURCHASE cancel) that emptied the earliest lot left
// earliestExpiry pointing at a now-zero batch.

describe('earliestExpiry is recomputed when a decrement empties the earliest lot', () => {
    // Draft SALE of 2 from the EARLIEST lot; a later lot still holds stock.
    const draftSale = () => storedInvoice({
        status: 'Draft', stockApplied: false,
        lines: [{
            productId: 'p_1', stockNo: '1239', name: 'Formula 1 - Strawberry',
            unitPrice: 1713, unitVp: 21.75, quantity: 2, lineAmount: 3426, lineVp: 43.5,
            expiryDate: '2026-11-15', unitCost: 1246,
        }],
    });

    it('finalizing a SALE that zeroes the earliest lot moves the cache to the next lot', async () => {
        const store = makeStore({
            invoices: [draftSale()],
            batches:  { 'p_1#2026-11-15': 2, 'p_1#2027-06-30': 5 },   // earliest exactly covers the sale
        });
        const res = await finalizeInvoice(mutate(store, 'inv_1'));
        expect(res.statusCode).toBe(200);
        expect(store.batchQty('p_1#2026-11-15')).toBe(0);            // emptied
        // Without the recompute this stays 2026-11-15 (an emptied lot). It must move on.
        expect(store.product('p_1')!.earliestExpiry).toBe('2027-06-30');
    });

    it('drops earliestExpiry entirely when the sale empties the only lot', async () => {
        const store = makeStore({
            invoices: [draftSale()],
            batches:  { 'p_1#2026-11-15': 2 },                        // the only stock
            products: { p_1: { earliestExpiry: '2026-11-15', totalQuantity: 2 } },  // stale after the sale
        });
        await finalizeInvoice(mutate(store, 'inv_1'));
        expect(store.batchQty('p_1#2026-11-15')).toBe(0);
        // The REMOVE has to actually clear the stale date, not just touch updatedAt.
        expect(store.product('p_1')!.earliestExpiry).toBeUndefined();
    });

    it('a PURCHASE cancel that empties the earliest lot also recomputes', async () => {
        // Finalized PURCHASE brought in the 2026-11-15 lot; a later lot exists.
        // Cancelling removes those units and must move the cache off the lot.
        const store = makeStore({
            invoices: [storedInvoice({
                id: 'pur_1', type: 'PURCHASE', invoiceNo: 'PUR-2026-0001', status: 'Finalized',
                lines: [{
                    productId: 'p_1', name: 'Formula 1 - Strawberry',
                    unitPrice: 1246, unitVp: 21.75, quantity: 4, lineAmount: 4984, lineVp: 87,
                    expiryDate: '2026-11-15',
                }],
                totalAmount: 4984, totalVp: 87,
            })],
            batches: { 'p_1#2026-11-15': 4, 'p_1#2027-06-30': 5 },
        });
        const res = await cancelInvoice(mutate(store, 'pur_1'));
        expect(res.statusCode).toBe(200);
        expect(store.batchQty('p_1#2026-11-15')).toBe(0);
        expect(store.product('p_1')!.earliestExpiry).toBe('2027-06-30');
    });

    it('a pure PURCHASE (no decrement) needs no recompute pass', async () => {
        // A purchase only ADDS stock; earliestExpiry is handled inline by the
        // engine, so no post-transaction product query should run at all.
        const store = makeStore({ invoices: [], batches: {} });
        let productQueries = 0;
        const spy: Send = async (cmd) => {
            const c = cmd as unknown as { constructor: { name: string }; input: { ExpressionAttributeValues?: Record<string, unknown> } };
            if (c.constructor.name === 'QueryCommand'
                && String(c.input.ExpressionAttributeValues?.[':prefix'] ?? '').startsWith('BATCH#')) {
                productQueries++;
            }
            return store.send(cmd);
        };
        await createInvoice({
            uid: UID, finalize: true, timeZone: 'Asia/Kolkata', now: NOW, today: TODAY,
            newId: ids(), send: spy,
            body: { id: 'pur_x', type: 'PURCHASE', partyName: 'S',
                    lines: [{ productId: 'p_1', expiryDate: '2027-06-30', quantity: 3 }] },
        });
        expect(productQueries).toBe(0);   // no recompute query for a pure add
    });
});

// ── POST /invoices/{id}/cancel ──────────────────────────────────────────────

describe('POST /invoices/{id}/cancel', () => {
    it('a SALE cancel adds the stock back', async () => {
        const store = makeStore({
            invoices: [storedInvoice({ type: 'SALE', status: 'Finalized' })],
            batches:  { 'p_1#2026-11-15': 8 },              // 2 were sold
        });
        const res = await cancelInvoice(mutate(store, 'inv_1'));
        expect(res.statusCode).toBe(200);
        expect(body<Invoice>(res).status).toBe('Cancelled');
        expect(store.batchQty('p_1#2026-11-15')).toBe(10);  // 8 + 2 back
    });

    it('a PURCHASE cancel removes the stock it brought in', async () => {
        const store = makeStore({
            invoices: [storedInvoice({
                id: 'pur_1', type: 'PURCHASE', invoiceNo: 'PUR-2026-0001', status: 'Finalized',
                lines: [{
                    productId: 'p_1', name: 'Formula 1 - Strawberry',
                    unitPrice: 1246, unitVp: 21.75, quantity: 12, lineAmount: 14952, lineVp: 261,
                    expiryDate: '2027-06-30',
                }],
                totalAmount: 14952, totalVp: 261,
            })],
            batches: { 'p_1#2027-06-30': 12 },
        });
        const res = await cancelInvoice(mutate(store, 'pur_1'));
        expect(res.statusCode).toBe(200);
        expect(store.batchQty('p_1#2027-06-30')).toBe(0);   // 12 - 12
    });

    it('a PURCHASE cancel whose stock was partly sold 409s STOCK_ALREADY_SOLD', async () => {
        const store = makeStore({
            invoices: [storedInvoice({
                id: 'pur_1', type: 'PURCHASE', invoiceNo: 'PUR-2026-0001', status: 'Finalized',
                lines: [{
                    productId: 'p_1', name: 'Formula 1 - Strawberry',
                    unitPrice: 1246, unitVp: 21.75, quantity: 12, lineAmount: 14952, lineVp: 261,
                    expiryDate: '2027-06-30',
                }],
                totalAmount: 14952, totalVp: 261,
            })],
            batches: { 'p_1#2027-06-30': 5 },               // 7 already sold on
        });
        const res = await cancelInvoice(mutate(store, 'pur_1'));
        expect(res.statusCode).toBe(409);
        expect(body(res)).toMatchObject({
            error: 'STOCK_ALREADY_SOLD', productId: 'p_1', expiryDate: '2027-06-30', available: 5,
        });
        // Nothing moved and the invoice stays Finalized — no half-cancel.
        expect(store.batchQty('p_1#2027-06-30')).toBe(5);
        expect(store.invoice('pur_1')!.status).toBe('Finalized');
    });

    it('cancelling twice does NOT double-reverse', async () => {
        const store = makeStore({
            invoices: [storedInvoice({ type: 'SALE', status: 'Finalized' })],
            batches:  { 'p_1#2026-11-15': 8 },
        });
        const first = await cancelInvoice(mutate(store, 'inv_1'));
        expect(first.statusCode).toBe(200);
        expect(store.batchQty('p_1#2026-11-15')).toBe(10);

        const second = await cancelInvoice(mutate(store, 'inv_1'));
        expect(second.statusCode).toBe(409);
        expect(body(second).error).toBe('ALREADY_CANCELLED');
        expect(store.batchQty('p_1#2026-11-15')).toBe(10);  // NOT 12
    });

    it('the transaction guard blocks a CONCURRENT double-cancel the read cannot see', async () => {
        // The sequential double-cancel above is caught by the read gate. This is
        // the case the read gate CANNOT catch: a rival cancel commits in the gap
        // between our read (sees Finalized) and our transaction. Only the
        // `#status = :finalized` condition on the invoice Put stops the reversal
        // from applying a second time.
        const store = makeStore({
            invoices: [storedInvoice({ type: 'SALE', status: 'Finalized' })],
            batches:  { 'p_1#2026-11-15': 8 },
        });
        let raced = false;
        const racy: Send = async (cmd) => {
            const c = cmd as unknown as { constructor: { name: string } };
            // Fires AFTER loadInvoice's GetCommand, BEFORE the transaction.
            if (c.constructor.name === 'BatchGetCommand' && !raced) {
                raced = true;
                store.simulateConcurrentWrite('inv_1', { status: 'Cancelled' });
            }
            return store.send(cmd);
        };
        const res = await cancelInvoice({ uid: UID, id: 'inv_1', now: NOW, newId: ids(), send: racy });
        expect(res.statusCode).toBe(409);
        expect(body(res).error).toBe('NOT_FINALIZED');
        expect(store.batchQty('p_1#2026-11-15')).toBe(8);   // NOT reversed to 10
    });

    it('rejects cancelling a Draft — there is no stock to reverse', async () => {
        const store = makeStore({ invoices: [storedInvoice({ status: 'Draft', stockApplied: false })] });
        const res = await cancelInvoice(mutate(store, 'inv_1'));
        expect(res.statusCode).toBe(409);
        expect(body(res).error).toBe('NOT_FINALIZED');
    });

    it('404s for an unknown id', async () => {
        const store = makeStore();
        const res = await cancelInvoice(mutate(store, 'nope'));
        expect(res.statusCode).toBe(404);
    });
});

// ── DELETE /invoices/{id} ───────────────────────────────────────────────────

describe('DELETE /invoices/{id}', () => {
    it('deletes a Draft and returns 204', async () => {
        const store = makeStore({ invoices: [storedInvoice({ status: 'Draft', stockApplied: false })] });
        const res = await deleteInvoice(UID, 'inv_1', store.send);
        expect(res.statusCode).toBe(204);
        expect(store.invoice('inv_1')).toBeUndefined();
    });

    it('refuses to delete a Finalized invoice with NOT_DRAFT', async () => {
        const store = makeStore({ invoices: [storedInvoice({ status: 'Finalized' })] });
        const res = await deleteInvoice(UID, 'inv_1', store.send);
        expect(res.statusCode).toBe(409);
        expect(body(res)).toMatchObject({ error: 'NOT_DRAFT', status: 'Finalized' });
        expect(store.invoice('inv_1')).toBeDefined();       // still there
    });

    it('refuses to delete a Cancelled invoice', async () => {
        const store = makeStore({ invoices: [storedInvoice({ status: 'Cancelled' })] });
        const res = await deleteInvoice(UID, 'inv_1', store.send);
        expect(res.statusCode).toBe(409);
        expect(body(res).error).toBe('NOT_DRAFT');
    });

    it('404s for an unknown id', async () => {
        const store = makeStore();
        const res = await deleteInvoice(UID, 'nope', store.send);
        expect(res.statusCode).toBe(404);
    });
});

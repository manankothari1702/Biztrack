import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { TABLE, keys } from './db';

/**
 * The stock engine.
 *
 * Every change to stock — sale, purchase, correction, write-off, cancellation —
 * funnels through here. It is the only place that knows how a batch delta, a
 * product roll-up and an audit movement fit together in one atomic write.
 *
 * `applyStockChange` BUILDS the transaction items and returns them; it never
 * calls DynamoDB. That keeps it a pure function of its inputs (clock and id
 * generator are injected), so the item construction — the part that is easy to
 * get subtly wrong and impossible to eyeball in production — is unit-testable.
 * The handler sends the returned items inside its own `TransactWriteCommand`,
 * usually alongside items of its own (e.g. the invoice `Put`).
 *
 * Design notes worth knowing before you edit:
 *
 *  - Stock lives on BATCH rows. `product.totalQuantity` / `product.earliestExpiry`
 *    are caches, updated in the same transaction so they can never drift.
 *  - Direction is carried by the SIGN of `delta`, not by `type`. `type` is an
 *    audit label. This lets a batch re-key be expressed as two ordinary changes
 *    (-n at the old expiry, +n at the new one) that the aggregator handles for free.
 *  - DynamoDB rejects a transaction that touches the same item twice, so changes
 *    are aggregated per batch key AND per product before any item is built.
 */

// A single element of TransactWriteCommand's TransactItems, in DocumentClient
// (plain JS value) form rather than raw AttributeValue form.
type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

/** DynamoDB's hard ceiling on items in one TransactWriteCommand. */
export const MAX_TRANSACT_ITEMS = 100;

export type MovementType = 'IN' | 'OUT' | 'ADJUST' | 'WRITE_OFF';

/**
 * One stock delta against one batch, identified by (productId, expiryDate).
 *
 * `delta` is signed: positive adds stock, negative removes it. `type` only
 * labels the audit record — but the two must agree (see `assertDirection`),
 * so an `IN` can never silently remove stock.
 */
export interface StockChange {
    productId: string;
    productName?: string;
    /** Date-only ISO (`YYYY-MM-DD`). Part of the batch's sort key. */
    expiryDate: string;
    /** Signed. Must be a non-zero integer. */
    delta: number;
    type: MovementType;
    /** Audit text, e.g. 'Sale — INV-2026-0001'. */
    reason?: string;
}

/** What the engine needs to know about a product to maintain its caches. */
export interface ProductSnapshot {
    id: string;
    name?: string;
    earliestExpiry?: string;
}

export interface ApplyStockChangeInput {
    uid: string;
    changes: readonly StockChange[];
    /** Current product rows, keyed by id. Read by the handler before calling. */
    products: Readonly<Record<string, ProductSnapshot>>;
    /** Injected clock — one timestamp for the whole transaction. */
    now: string;
    /** Injected id factory (uuid in production). */
    newId: () => string;
}

/** The audit row written for each change. */
export interface StockMovementRecord {
    id: string;
    productId: string;
    productName?: string;
    batchExpiry: string;
    type: MovementType;
    /** Always positive — direction is implied by `type`. */
    quantity: number;
    reason?: string;
    createdAt: string;
}

export interface StockChangePlan {
    /** Ready to drop into `new TransactWriteCommand({ TransactItems: [...] })`. */
    items: TransactItem[];
    /** The movement rows contained in `items`, for echoing back to the client. */
    movements: StockMovementRecord[];
    /**
     * Products whose cached `earliestExpiry` may now be too early.
     *
     * A decrement can empty the earliest batch, which moves the true minimum
     * LATER — and finding the new minimum needs a query, which transactions
     * forbid. The caller must recompute these AFTER the transaction commits.
     * Staleness here is safe: it warns too early, never too late.
     */
    productsNeedingExpiryRecompute: string[];
}

/** Programming errors — the handler is expected to reject bad user input first. */
export class StockChangeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StockChangeError';
    }
}

// `quantity` and `id` are aliased in every expression below. Neither is on
// DynamoDB's reserved-word list today, but both are short, generic names of
// exactly the kind AWS keeps adding, and an alias costs nothing.
const NAMES = { '#qty': 'quantity', '#id': 'id' } as const;

const batchId = (productId: string, expiryDate: string): string =>
    `${productId}#${expiryDate}`;

const assertDirection = (change: StockChange): void => {
    const { type, delta, productId, expiryDate } = change;
    const where = `${productId}@${expiryDate}`;

    if (!Number.isInteger(delta)) {
        throw new StockChangeError(`${where}: delta must be a whole number, got ${delta}`);
    }
    if (delta === 0) {
        throw new StockChangeError(`${where}: delta must be non-zero`);
    }
    if (type === 'IN' && delta < 0) {
        throw new StockChangeError(`${where}: IN must add stock, got delta ${delta}`);
    }
    if ((type === 'OUT' || type === 'WRITE_OFF') && delta > 0) {
        throw new StockChangeError(`${where}: ${type} must remove stock, got delta +${delta}`);
    }
    // ADJUST may go either way — a correction can raise or lower a batch.
};

/**
 * Build the transaction items for a set of stock changes.
 *
 * Produces, in order: one Update per touched batch, one Update per touched
 * product, one Put per change (the movement log).
 */
export const applyStockChange = (input: ApplyStockChangeInput): StockChangePlan => {
    const { uid, changes, products, now, newId } = input;

    if (changes.length === 0) {
        return { items: [], movements: [], productsNeedingExpiryRecompute: [] };
    }

    // ── Validate, and aggregate before building ─────────────────────────────
    // Two lines of one invoice can touch the same batch, and two different
    // batches of the same product always touch the same product row. Either
    // would put a duplicate key in the transaction, which DynamoDB rejects
    // outright — so collapse both dimensions first.

    interface BatchAgg {
        productId: string;
        productName?: string;
        expiryDate: string;
        netDelta: number;
    }
    interface ProductAgg {
        productId: string;
        netDelta: number;
        /** Earliest expiry among this product's INCOMING stock, if any. */
        minIncomingExpiry?: string;
        /** True if anything was removed — the cache may need recomputing. */
        hasDecrement: boolean;
    }

    const batchAggs   = new Map<string, BatchAgg>();
    const productAggs = new Map<string, ProductAgg>();

    for (const change of changes) {
        assertDirection(change);

        if (!products[change.productId]) {
            throw new StockChangeError(
                `${change.productId}: product not found — the handler must load and validate products first`,
            );
        }

        const key = batchId(change.productId, change.expiryDate);
        const batch = batchAggs.get(key);
        if (batch) {
            batch.netDelta += change.delta;
            batch.productName ??= change.productName;
        } else {
            batchAggs.set(key, {
                productId:   change.productId,
                productName: change.productName,
                expiryDate:  change.expiryDate,
                netDelta:    change.delta,
            });
        }

        const product = productAggs.get(change.productId);
        if (product) {
            product.netDelta     += change.delta;
            product.hasDecrement ||= change.delta < 0;
            if (change.delta > 0 && (!product.minIncomingExpiry || change.expiryDate < product.minIncomingExpiry)) {
                product.minIncomingExpiry = change.expiryDate;
            }
        } else {
            productAggs.set(change.productId, {
                productId:         change.productId,
                netDelta:          change.delta,
                minIncomingExpiry: change.delta > 0 ? change.expiryDate : undefined,
                hasDecrement:      change.delta < 0,
            });
        }
    }

    const items: TransactItem[] = [];

    // ── 1. Batch rows ───────────────────────────────────────────────────────

    for (const batch of batchAggs.values()) {
        // Changes that cancel out exactly (e.g. -3 then +3) leave the batch
        // untouched. Emitting a no-op Update would only burn a transaction slot.
        if (batch.netDelta === 0) continue;

        const key = keys.batch(uid, batch.productId, batch.expiryDate);

        if (batch.netDelta > 0) {
            // Upsert: `ADD` creates the row at 0 first if it does not exist, so
            // a restock at a brand-new expiry and a merge into an existing batch
            // are the same write.
            items.push({
                Update: {
                    TableName: TABLE,
                    Key:       key,
                    UpdateExpression:
                        'ADD #qty :delta ' +
                        'SET #id = if_not_exists(#id, :batchId), ' +
                            'productId = :productId, ' +
                            'expiryDate = :expiryDate, ' +
                            'invDate = :expiryDate, ' +   // GSI6-InventoryDate sort key
                            'productName = if_not_exists(productName, :productName), ' +
                            'createdAt = if_not_exists(createdAt, :now), ' +
                            'updatedAt = :now',
                    ExpressionAttributeNames:  { ...NAMES },
                    ExpressionAttributeValues: {
                        ':delta':       batch.netDelta,
                        ':batchId':     batchId(batch.productId, batch.expiryDate),
                        ':productId':   batch.productId,
                        ':expiryDate':  batch.expiryDate,
                        ':productName': batch.productName ?? products[batch.productId].name ?? null,
                        ':now':         now,
                    },
                },
            });
        } else {
            const magnitude = -batch.netDelta;
            // THE oversell guard. Never read-then-check: a concurrent sale that
            // would overdraw fails this condition, DynamoDB cancels the whole
            // transaction, and the handler returns 409 INSUFFICIENT_STOCK.
            // It also covers a batch that does not exist at all — the attribute
            // is absent, so the comparison fails and nothing is written.
            items.push({
                Update: {
                    TableName: TABLE,
                    Key:       key,
                    UpdateExpression:          'ADD #qty :delta SET updatedAt = :now',
                    ConditionExpression:       '#qty >= :magnitude',
                    ExpressionAttributeNames:  { '#qty': NAMES['#qty'] },
                    ExpressionAttributeValues: {
                        ':delta':     batch.netDelta,   // negative
                        ':magnitude': magnitude,        // positive
                        ':now':       now,
                    },
                },
            });
        }
    }

    // ── 2. Product roll-ups ─────────────────────────────────────────────────

    const productsNeedingExpiryRecompute: string[] = [];

    for (const agg of productAggs.values()) {
        if (agg.hasDecrement) productsNeedingExpiryRecompute.push(agg.productId);

        // Incoming stock can only pull the earliest expiry EARLIER, and that is
        // computable right here from what we already read — no query needed.
        // (Outgoing stock can push it later, which does need a query; that is
        // what productsNeedingExpiryRecompute is for.)
        const current      = products[agg.productId].earliestExpiry;
        const incoming     = agg.minIncomingExpiry;
        const lowersExpiry = incoming !== undefined && (current === undefined || incoming < current);

        if (agg.netDelta === 0 && !lowersExpiry) continue;

        // Every attribute here is an unambiguous compound name, so no aliases
        // are needed (unlike the batch expressions, which touch `quantity`).
        const sets: string[] = ['updatedAt = :now'];
        const values: Record<string, unknown> = { ':now': now };

        let expression = '';
        if (agg.netDelta !== 0) {
            expression += 'ADD totalQuantity :delta ';
            values[':delta'] = agg.netDelta;
        }
        if (lowersExpiry) {
            sets.push('earliestExpiry = :earliestExpiry');
            values[':earliestExpiry'] = incoming;
        }
        expression += `SET ${sets.join(', ')}`;

        items.push({
            Update: {
                TableName: TABLE,
                Key:       keys.product(uid, agg.productId),
                UpdateExpression:          expression,
                ExpressionAttributeValues: values,
            },
        });
    }

    // ── 3. Movement log ─────────────────────────────────────────────────────
    // One row per INPUT change, not per aggregated batch — two invoice lines
    // that merge into one batch update still leave two audit entries.

    const movements: StockMovementRecord[] = [];

    for (const change of changes) {
        const id = newId();
        const movement: StockMovementRecord = {
            id,
            productId:   change.productId,
            productName: change.productName ?? products[change.productId].name,
            batchExpiry: change.expiryDate,
            type:        change.type,
            quantity:    Math.abs(change.delta),
            reason:      change.reason,
            createdAt:   now,
        };
        movements.push(movement);

        items.push({
            Put: {
                TableName: TABLE,
                Item: {
                    ...movement,
                    ...keys.stockMove(uid, now, id),   // keys spread last — they must win
                },
            },
        });
    }

    if (items.length > MAX_TRANSACT_ITEMS) {
        throw new StockChangeError(
            `stock change needs ${items.length} transaction items, exceeding DynamoDB's limit of ${MAX_TRANSACT_ITEMS}`,
        );
    }

    return { items, movements, productsNeedingExpiryRecompute };
};

/**
 * Recompute a product's `earliestExpiry` from its batches.
 *
 * Call AFTER a transaction that decremented stock, for each id in
 * `productsNeedingExpiryRecompute`. Returns the new value, or `undefined` when
 * the product has no stock left anywhere. Batches with zero quantity are kept
 * as history but must not hold the cache hostage — they are ignored here.
 */
export const earliestExpiryOf = (
    batches: readonly { expiryDate: string; quantity: number }[],
): string | undefined => {
    let earliest: string | undefined;
    for (const batch of batches) {
        if (batch.quantity <= 0) continue;
        if (earliest === undefined || batch.expiryDate < earliest) earliest = batch.expiryDate;
    }
    return earliest;
};

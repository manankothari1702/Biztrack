import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys } from './lib/db';
import { ok, badRequest, notFound, conflict, serverError, unauthorized, tryGetUid, resolveCors } from './lib/response';
import { guardAccount } from './lib/accountGuard';
import { stripTableKeys } from './lib/sanitize';
import { addDaysIso, isIsoDate, todayIso, DEFAULT_TIMEZONE } from './lib/dates';
import { applyStockChange, earliestExpiryOf, type ProductSnapshot, type StockChange } from './lib/stock';

// ── Types ──────────────────────────────────────────────────────────────────

interface Batch {
    id: string;
    productId: string;
    productName?: string;
    expiryDate: string;
    quantity: number;
    invDate?: string;
    createdAt: string;
    [key: string]: unknown;
}

const EXPIRY_INDEX = 'GSI6-InventoryDate';

const WRITE_OFF_REASONS = ['Expired', 'Damaged', 'Other'] as const;
type WriteOffReason = typeof WRITE_OFF_REASONS[number];

// ── Handler ────────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        resolveCors(event);
        const uid = tryGetUid(event);
        if (!uid) return unauthorized();

        const { blocked, profile } = await guardAccount(uid);
        if (blocked) return blocked;

        const method    = event.httpMethod;
        const path      = event.resource ?? event.path;
        const productId = event.pathParameters?.productId;
        const expiry    = event.pathParameters?.expiry;

        // Sub-path first — /write-off also carries productId and expiry, so it
        // would otherwise be caught by the PUT route below.
        if (path.endsWith('/write-off')) {
            if (method === 'POST' && productId && expiry) {
                return await writeOffBatch(uid, productId, expiry, event);
            }
        }

        if (method === 'GET' && !productId) {
            return await listBatchesByExpiry(uid, event, timezoneOf(profile));
        }
        if (method === 'PUT' && productId && expiry) {
            return await adjustBatch(uid, productId, expiry, event);
        }

        return badRequest('VALIDATION', 'Unknown route');
    } catch (err) {
        return serverError(err);
    }
};

const timezoneOf = (profile: Record<string, unknown> | null): string =>
    typeof profile?.timezone === 'string' && profile.timezone ? profile.timezone : DEFAULT_TIMEZONE;

// ── List batches by expiry (GSI6-InventoryDate range) ──────────────────────
//
// Self-contained: this builds its OWN KeyCondition, Filter and value map from
// scratch and shares no expression seed with any other query in the codebase.
// That convention exists because a shared seed previously left an orphaned
// :prefix binding behind and produced wrong results — see the same note on
// tasks.ts::listTasksByDateRange, which this mirrors.
//
// GSI6 is keyed (PK, invDate). Batches write invDate = expiryDate, so a range
// on the sort key reads ONLY the batches in the window rather than scanning the
// partition. Invoices share the index (invDate = createdAt), which is why the
// SK prefix filter below is not optional.
const listBatchesByExpiry = async (
    uid: string,
    event: APIGatewayProxyEvent,
    timeZone: string,
): Promise<APIGatewayProxyResult> => {
    const q = event.queryStringParameters ?? {};

    const pageSize = Math.min(parseInt(q.limit ?? '200', 10), 500);
    const lastKey  = q.nextToken ? JSON.parse(Buffer.from(q.nextToken, 'base64').toString()) : undefined;

    // "Today" must be the user's calendar day, not the Lambda's UTC one.
    const today = todayIso(timeZone);

    const values: Record<string, unknown> = { ':pk': `USER#${uid}`, ':prefix': 'BATCH#', ':zero': 0 };
    const names:  Record<string, string>  = { '#qty': 'quantity' };

    let keyCondition: string;
    if (q.status === 'expired') {
        keyCondition = 'PK = :pk AND invDate < :today';
        values[':today'] = today;
    } else if (q.expiringInDays !== undefined) {
        const days = parseInt(q.expiringInDays, 10);
        if (!Number.isFinite(days) || days < 0) {
            return badRequest('VALIDATION', 'expiringInDays must be a non-negative number');
        }
        // Inclusive of today: something expiring today is expiring, not expired.
        keyCondition = 'PK = :pk AND invDate BETWEEN :today AND :horizon';
        values[':today']   = today;
        values[':horizon'] = addDaysIso(today, days);
    } else {
        // No window — every batch, soonest expiry first.
        keyCondition = 'PK = :pk';
    }

    // Emptied batches are kept as history (movements reference them) but never
    // surface in an alert or a picker.
    const filterParts = ['begins_with(SK, :prefix)', '#qty > :zero'];

    if (q.productId) {
        filterParts.push('productId = :productId');
        values[':productId'] = q.productId;
    }

    const result = await db.send(new QueryCommand({
        TableName:                 TABLE,
        IndexName:                 EXPIRY_INDEX,
        KeyConditionExpression:    keyCondition,
        FilterExpression:          filterParts.join(' AND '),
        ExpressionAttributeValues: values,
        ExpressionAttributeNames:  names,
        Limit:                     pageSize,
        ExclusiveStartKey:         lastKey,
        ScanIndexForward:          true,   // invDate ascending -> soonest first
    }));

    const batches = (result.Items ?? []).map(stripKeys);
    const nextToken = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null;

    return ok({ batches, nextToken });
};

// ── Adjust a batch (manual correction) ─────────────────────────────────────

const adjustBatch = async (
    uid: string,
    productId: string,
    expiry: string,
    event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
    const body = parseBody<{ quantity: number; expiryDate?: string; note?: string }>(event);
    if (!body) return badRequest('VALIDATION', 'Request body is required');

    const safe = stripTableKeys(body);

    if (typeof safe.quantity !== 'number' || !Number.isInteger(safe.quantity) || safe.quantity < 0) {
        return badRequest('VALIDATION', 'quantity must be a non-negative whole number');
    }
    if (safe.expiryDate !== undefined && !isIsoDate(safe.expiryDate)) {
        return badRequest('VALIDATION', 'expiryDate must be a real calendar date in YYYY-MM-DD form');
    }
    if (!isIsoDate(expiry)) {
        return badRequest('VALIDATION', 'expiry path segment must be a real calendar date in YYYY-MM-DD form');
    }

    const [batch, product] = await Promise.all([
        loadBatch(uid, productId, expiry),
        loadProduct(uid, productId),
    ]);
    if (!batch)   return notFound('NOT_FOUND', 'Batch not found', { productId, expiryDate: expiry });
    if (!product) return notFound('NOT_FOUND', 'Product not found', { productId });

    const changes = planBatchAdjustment({
        productId,
        productName:     typeof batch.productName === 'string' ? batch.productName : undefined,
        currentExpiry:   expiry,
        currentQuantity: Number(batch.quantity ?? 0),
        targetQuantity:  safe.quantity,
        targetExpiry:    safe.expiryDate,
        note:            typeof safe.note === 'string' ? safe.note : undefined,
    });

    const finalExpiry = safe.expiryDate ?? expiry;

    // Nothing actually changed — don't burn a transaction or log a movement.
    if (changes.length === 0) return ok(stripKeys(batch));

    const applied = await runStockChange(uid, changes, product);
    if ('error' in applied) return applied.error;

    const updated = await loadBatch(uid, productId, finalExpiry);
    return ok(updated ? stripKeys(updated) : { productId, expiryDate: finalExpiry, quantity: safe.quantity });
};

// ── Write off a batch ──────────────────────────────────────────────────────

const writeOffBatch = async (
    uid: string,
    productId: string,
    expiry: string,
    event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
    const body = parseBody<{ reason: WriteOffReason; note?: string }>(event);
    if (!body) return badRequest('VALIDATION', 'Request body is required');

    const safe = stripTableKeys(body);

    if (!WRITE_OFF_REASONS.includes(safe.reason)) {
        return badRequest('VALIDATION',
            `reason must be one of: ${WRITE_OFF_REASONS.join(', ')}`, { allowed: WRITE_OFF_REASONS });
    }
    if (!isIsoDate(expiry)) {
        return badRequest('VALIDATION', 'expiry path segment must be a real calendar date in YYYY-MM-DD form');
    }

    const [batch, product] = await Promise.all([
        loadBatch(uid, productId, expiry),
        loadProduct(uid, productId),
    ]);
    if (!batch)   return notFound('NOT_FOUND', 'Batch not found', { productId, expiryDate: expiry });
    if (!product) return notFound('NOT_FOUND', 'Product not found', { productId });

    const quantity = Number(batch.quantity ?? 0);
    if (quantity <= 0) {
        return conflict('BATCH_EMPTY', 'This batch has no stock left to write off',
            { productId, expiryDate: expiry, available: 0 });
    }

    const changes = planWriteOff({
        productId,
        productName: typeof batch.productName === 'string' ? batch.productName : undefined,
        expiryDate:  expiry,
        quantity,
        reason:      safe.reason,
        note:        typeof safe.note === 'string' ? safe.note : undefined,
    });

    const applied = await runStockChange(uid, changes, product);
    if ('error' in applied) return applied.error;

    const updated = await loadBatch(uid, productId, expiry);
    return ok({
        batch:      updated ? stripKeys(updated) : { productId, expiryDate: expiry, quantity: 0 },
        writtenOff: quantity,
    });
};

// ── Planners (pure) ────────────────────────────────────────────────────────

/**
 * Turn a manual correction into stock changes.
 *
 * `targetQuantity` is ABSOLUTE — the user states what the batch actually holds,
 * and the delta is derived. A changed expiry becomes a RE-KEY: the expiry is
 * part of the sort key, so the stock is removed from the old row and added to
 * the new one. Expressing that as two ordinary changes means the engine's
 * aggregation, conditions and movement logging all apply unmodified, and the
 * `ADD` on the destination merges automatically if a batch already exists there.
 *
 * The emptied source row is left at zero rather than deleted — zero-quantity
 * batches are retained as history because movement records point at them
 * (Data Model §3). They are hidden from lists by default.
 */
export const planBatchAdjustment = (input: {
    productId: string;
    productName?: string;
    currentExpiry: string;
    currentQuantity: number;
    targetQuantity: number;
    targetExpiry?: string;
    note?: string;
}): StockChange[] => {
    const { productId, productName, currentExpiry, currentQuantity, targetQuantity, note } = input;
    const targetExpiry = input.targetExpiry ?? currentExpiry;
    const suffix = note ? ` — ${note}` : '';

    // Same expiry: a plain quantity correction, one change.
    if (targetExpiry === currentExpiry) {
        const delta = targetQuantity - currentQuantity;
        if (delta === 0) return [];
        return [{
            productId, productName,
            expiryDate: currentExpiry,
            delta,
            type: 'ADJUST',
            reason: `Correction${suffix}`,
        }];
    }

    // Re-key. Guard both legs against a zero delta, which the engine rejects.
    const changes: StockChange[] = [];
    if (currentQuantity !== 0) {
        changes.push({
            productId, productName,
            expiryDate: currentExpiry,
            delta: -currentQuantity,
            type: 'ADJUST',
            reason: `Expiry corrected to ${targetExpiry}${suffix}`,
        });
    }
    if (targetQuantity !== 0) {
        changes.push({
            productId, productName,
            expiryDate: targetExpiry,
            delta: targetQuantity,
            type: 'ADJUST',
            reason: `Expiry corrected from ${currentExpiry}${suffix}`,
        });
    }
    return changes;
};

/** Zero a batch out. The whole remaining quantity leaves as one WRITE_OFF. */
export const planWriteOff = (input: {
    productId: string;
    productName?: string;
    expiryDate: string;
    quantity: number;
    reason: string;
    note?: string;
}): StockChange[] => {
    if (input.quantity <= 0) return [];
    return [{
        productId:   input.productId,
        productName: input.productName,
        expiryDate:  input.expiryDate,
        delta:       -input.quantity,
        type:        'WRITE_OFF',
        reason:      input.note ? `${input.reason} — ${input.note}` : input.reason,
    }];
};

// ── Shared execution path ──────────────────────────────────────────────────

/**
 * Build the transaction through lib/stock.ts, send it, then run the
 * earliestExpiry recompute pass. No handler builds transaction items itself.
 */
const runStockChange = async (
    uid: string,
    changes: StockChange[],
    product: Record<string, unknown>,
): Promise<{ ok: true } | { error: APIGatewayProxyResult }> => {
    const snapshot: ProductSnapshot = {
        id:             String(product.id),
        name:           typeof product.name === 'string' ? product.name : undefined,
        earliestExpiry: typeof product.earliestExpiry === 'string' ? product.earliestExpiry : undefined,
    };

    const plan = applyStockChange({
        uid,
        changes,
        products: { [snapshot.id]: snapshot },
        now:      new Date().toISOString(),
        newId:    randomUUID,
    });

    try {
        await db.send(new TransactWriteCommand({ TransactItems: plan.items }));
    } catch (err) {
        const failed = conditionFailure(err);
        if (failed) {
            return { error: conflict('INSUFFICIENT_STOCK',
                'The batch changed while this correction was in flight — reload and try again',
                { productId: snapshot.id }) };
        }
        throw err;
    }

    await recomputeEarliestExpiry(uid, plan.productsNeedingExpiryRecompute);
    return { ok: true };
};

/**
 * Refresh `product.earliestExpiry` after stock left a batch.
 *
 * Removing stock can push the minimum LATER, and finding the new minimum needs
 * a query — which a transaction cannot contain. So it happens here, afterwards,
 * against the committed state.
 *
 * Best-effort by design: if this fails the cached value stays EARLIER than the
 * truth, which only makes an alert fire sooner than it needs to. The opposite
 * error — appearing fresher than it is — is the one that matters, and it cannot
 * happen this way.
 */
const recomputeEarliestExpiry = async (uid: string, productIds: readonly string[]): Promise<void> => {
    for (const productId of productIds) {
        try {
            const batches = await loadProductBatches(uid, productId);
            const earliest = earliestExpiryOf(batches);

            await db.send(new UpdateCommand({
                TableName: TABLE,
                Key:       keys.product(uid, productId),
                ...(earliest
                    ? {
                        UpdateExpression:          'SET earliestExpiry = :e, updatedAt = :now',
                        ExpressionAttributeValues: { ':e': earliest, ':now': new Date().toISOString() },
                      }
                    : {
                        // No stock left anywhere — drop the attribute rather than
                        // leaving a stale date pointing at an emptied batch.
                        UpdateExpression:          'REMOVE earliestExpiry SET updatedAt = :now',
                        ExpressionAttributeValues: { ':now': new Date().toISOString() },
                      }),
            }));
        } catch (err) {
            console.error(JSON.stringify({
                level: 'warn',
                event: 'earliest_expiry_recompute_failed',
                uid, productId,
                message: err instanceof Error ? err.message : String(err),
            }));
        }
    }
};

/** True when a transaction was cancelled by a failed ConditionExpression. */
const conditionFailure = (err: unknown): boolean => {
    const e = err as { name?: string; CancellationReasons?: { Code?: string }[] };
    if (e?.name !== 'TransactionCanceledException') return false;
    return (e.CancellationReasons ?? []).some(r => r?.Code === 'ConditionalCheckFailed');
};

// ── Loads ──────────────────────────────────────────────────────────────────

const loadBatch = async (uid: string, productId: string, expiry: string): Promise<Batch | null> => {
    const result = await db.send(new GetCommand({
        TableName: TABLE, Key: keys.batch(uid, productId, expiry),
    }));
    return (result.Item as Batch | undefined) ?? null;
};

const loadProduct = async (uid: string, productId: string): Promise<Record<string, unknown> | null> => {
    const result = await db.send(new GetCommand({
        TableName: TABLE, Key: keys.product(uid, productId),
    }));
    return result.Item ?? null;
};

/** Every batch of one product, across pages — the recompute needs them all. */
const loadProductBatches = async (
    uid: string,
    productId: string,
): Promise<{ expiryDate: string; quantity: number }[]> => {
    const batches: { expiryDate: string; quantity: number }[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const result = await db.send(new QueryCommand({
            TableName:                 TABLE,
            KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': `USER#${uid}`, ':prefix': `BATCH#${productId}#` },
            ExclusiveStartKey:         lastKey,
        }));
        for (const item of result.Items ?? []) {
            batches.push({ expiryDate: String(item.expiryDate), quantity: Number(item.quantity ?? 0) });
        }
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return batches;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const parseBody = <T>(event: APIGatewayProxyEvent): T | null => {
    if (!event.body) return null;
    try {
        return JSON.parse(event.body) as T;
    } catch {
        return null;
    }
};

// Remove DynamoDB table keys (PK/SK) from response
const stripKeys = (item: Record<string, unknown>): Record<string, unknown> => {
    const { PK, SK, ...rest } = item;
    void PK; void SK;
    return rest;
};

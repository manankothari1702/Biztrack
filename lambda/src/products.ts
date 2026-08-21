import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { PutCommand, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys } from './lib/db';
import { ok, created, noContent, badRequest, notFound, serverError, unauthorized, tryGetUid, resolveCors } from './lib/response';
import { guardAccount } from './lib/accountGuard';
import { stripTableKeys } from './lib/sanitize';
import { batchWriteAll, BULK_DEADLINE_MS, type WriteReq } from './lib/batch';
import { addDaysIso, todayIso } from './lib/dates';

// ── Types ──────────────────────────────────────────────────────────────────

interface Product {
    id: string;
    name: string;
    nameLower: string;
    stockNo?: string;
    category: string;
    vp: number;
    retail: number;
    price25: number;
    price35: number;
    price42: number;
    price50: number;
    reorderLevel: number;
    // Server-owned — maintained transactionally by lib/stock.ts, never by this file.
    totalQuantity: number;
    earliestExpiry?: string;
    createdAt: string;
    [key: string]: unknown;
}

/**
 * Fields this handler must never take from a client body.
 *
 * Stock lives on BATCH rows; `totalQuantity` / `earliestExpiry` are caches that
 * only `lib/stock.ts` may write, inside a transaction that also moves the
 * batches. A catalogue edit that set them directly would silently desync the
 * two. `invDate` is a GSI key and belongs to batches/invoices, not products.
 *
 * These are DROPPED from inbound bodies (not rejected) and carried over from
 * the stored item instead — see `updateProduct`. Rejecting would break the
 * app's established full-object PUT: the client round-trips the whole Product
 * it was given, so a legitimate rename would fail merely for echoing back the
 * `totalQuantity` the server itself sent.
 */
export const SERVER_OWNED = ['totalQuantity', 'earliestExpiry', 'invDate'] as const;

const MAX_BULK_PRODUCTS = 1000;

export const stripServerOwned = <T extends Record<string, unknown>>(body: T): T => {
    const copy = { ...body };
    for (const field of SERVER_OWNED) delete copy[field];
    return copy;
};

// ── Item builders (pure) ───────────────────────────────────────────────────
//
// Every write path funnels through these two, for the same reason lib/stock.ts
// returns items instead of sending them: the roll-up invariant is the thing
// most likely to break silently, so it lives in a function that can be asserted
// on directly rather than inside a handler that needs DynamoDB to observe.
//
// Both strip SERVER_OWNED themselves — they are authoritative, not merely
// trusting of their callers.

/** A brand-new catalogue row. Never carries stock: a product starts empty. */
export const newProductItem = (input: {
    uid: string;
    body: Record<string, unknown>;
    id: string;
    now: string;
}): Record<string, unknown> => {
    const safe = stripServerOwned(input.body);
    return {
        ...safe,
        ...catalogueDefaults(safe),
        totalQuantity: 0,
        createdAt: typeof safe.createdAt === 'string' ? safe.createdAt : input.now,
        ...keys.product(input.uid, input.id),   // keys MUST win
        id: input.id,
    };
};

/**
 * A catalogue edit applied over an existing row.
 *
 * `totalQuantity` / `earliestExpiry` / `createdAt` are taken from the STORED
 * item, never the request. This is what makes a full-item Put safe: without it,
 * a PUT would either erase the roll-ups (absent from the body) or corrupt them
 * (stale values echoed back by a client that fetched minutes ago).
 */
export const mergeProductItem = (input: {
    uid: string;
    existing: Record<string, unknown>;
    body: Record<string, unknown>;
    now: string;
}): Record<string, unknown> => {
    const safe = stripServerOwned(input.body);
    const id   = String(input.existing.id);
    return {
        ...safe,
        ...catalogueDefaults(safe),
        totalQuantity:  input.existing.totalQuantity ?? 0,
        earliestExpiry: input.existing.earliestExpiry,
        createdAt:      input.existing.createdAt ?? input.now,
        updatedAt:      input.now,
        ...keys.product(input.uid, id),         // keys MUST win
        id,
    };
};

// ── Handler ────────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        resolveCors(event);
        const uid = tryGetUid(event);
        if (!uid) return unauthorized();

        const { blocked } = await guardAccount(uid);
        if (blocked) return blocked;

        const method = event.httpMethod;
        const id     = event.pathParameters?.id;
        const path   = event.resource ?? event.path;

        // Sub-paths first — /products/{id}/batches also carries an id, so it
        // would otherwise be swallowed by the GET /products/{id} route below.
        if (path.endsWith('/batches')) {
            if (method === 'GET' && id) return await listProductBatches(uid, id, event);
        }

        if (path.endsWith('/bulk')) {
            if (method === 'POST')   return await bulkUpsert(uid, event);
            if (method === 'DELETE') return await bulkDelete(uid, event);
        }

        if (method === 'GET'    && !id) return await listProducts(uid, event);
        if (method === 'POST'   && !id) return await addProduct(uid, event);
        if (method === 'GET'    &&  id) return await getProduct(uid, id);
        if (method === 'PUT'    &&  id) return await updateProduct(uid, id, event);
        if (method === 'DELETE' &&  id) return await deleteProduct(uid, id);

        return badRequest('VALIDATION', 'Unknown route');
    } catch (err) {
        return serverError(err);
    }
};

// ── List products ──────────────────────────────────────────────────────────

const listProducts = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const q = event.queryStringParameters ?? {};

    const pageSize = Math.min(parseInt(q.limit ?? '50'), 200);
    const lastKey  = q.nextToken ? JSON.parse(Buffer.from(q.nextToken, 'base64').toString()) : undefined;

    const values: Record<string, unknown> = { ':pk': `USER#${uid}`, ':prefix': 'PRODUCT#' };
    const names:  Record<string, string>  = {};
    const filterParts: string[] = [];

    // Search by name (case-insensitive via the stored nameLower) or stock no.
    // Stock numbers are digits plus uppercase suffixes ("1239", "127K"), so the
    // term is upper-cased for that half rather than carrying a second
    // lower-cased copy of the field.
    if (q.search) {
        filterParts.push('(contains(nameLower, :searchLower) OR contains(stockNo, :searchUpper))');
        values[':searchLower'] = q.search.toLowerCase().trim();
        values[':searchUpper'] = q.search.toUpperCase().trim();
    }

    if (q.category && q.category !== 'All') {
        filterParts.push('#category = :category');
        names['#category']  = 'category';   // short generic noun — aliased defensively
        values[':category'] = q.category;
    }

    // Stock status is derived, not stored: compare the cached roll-up against
    // the product's own reorderLevel. DynamoDB can compare two attribute paths.
    if (q.stockStatus === 'Out of Stock') {
        filterParts.push('totalQuantity <= :zero');
        values[':zero'] = 0;
    } else if (q.stockStatus === 'Low Stock') {
        filterParts.push('totalQuantity > :zero AND totalQuantity <= reorderLevel');
        values[':zero'] = 0;
    } else if (q.stockStatus === 'In Stock') {
        filterParts.push('totalQuantity > reorderLevel');
    }

    // Expiry filtering uses the cached earliestExpiry so the list stays one
    // query — no per-product batch fan-out. Batch-level precision lives on
    // GET /batches, which ranges over GSI6-InventoryDate.
    if (q.expiringInDays) {
        const days = parseInt(q.expiringInDays, 10);
        if (!Number.isFinite(days) || days < 0) {
            return badRequest('VALIDATION', 'expiringInDays must be a non-negative number');
        }
        const today = todayIso();
        filterParts.push('attribute_exists(earliestExpiry) AND earliestExpiry BETWEEN :today AND :horizon');
        values[':today']   = today;
        values[':horizon'] = addDaysIso(today, days);
    } else if (q.status === 'expired') {
        filterParts.push('attribute_exists(earliestExpiry) AND earliestExpiry < :today');
        values[':today'] = todayIso();
    }

    // begins_with lives in the KEY condition, not a filter (clients.ts does the
    // same on the base table). That reads only PRODUCT# items instead of the
    // user's whole partition — and it makes `Limit` mean "products", since
    // DynamoDB applies Limit to items READ, before any FilterExpression.
    const result = await db.send(new QueryCommand({
        TableName:                 TABLE,
        KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression:          filterParts.length ? filterParts.join(' AND ') : undefined,
        ExpressionAttributeValues: values,
        ExpressionAttributeNames:  Object.keys(names).length ? names : undefined,
        Limit:                     pageSize,
        ExclusiveStartKey:         lastKey,
    }));

    // Sorting is applied to the returned PAGE only — DynamoDB orders by sort
    // key (PRODUCT#<uuid>, i.e. arbitrary) and cannot sort by an attribute
    // without an index. The frontend hook exhausts every page before rendering
    // (matching useClients), so the user still sees a fully ordered list.
    const products = sortProducts((result.Items ?? []).map(stripKeys), q.sortBy);

    const nextToken = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null;

    return ok({ products, nextToken, count: result.Count ?? 0 });
};

type Comparator = (a: Record<string, unknown>, b: Record<string, unknown>) => number;

const text = (v: unknown) => String(v ?? '');
const num  = (v: unknown) => Number(v ?? 0);

const COMPARATORS: Record<string, Comparator> = {
    name:     (a, b) => text(a.nameLower || a.name).localeCompare(text(b.nameLower || b.name)),
    stockNo:  (a, b) => text(a.stockNo).localeCompare(text(b.stockNo)),
    quantity: (a, b) => num(b.totalQuantity) - num(a.totalQuantity),           // most stock first
    value:    (a, b) => num(b.totalQuantity) * num(b.price50)
                      - num(a.totalQuantity) * num(a.price50),                 // most valuable first
    // Products with no stock (hence no cached expiry) sort LAST, not first —
    // an absent date must not masquerade as the most urgent one.
    expiry:   (a, b) => text(a.earliestExpiry || '9999-12-31')
                        .localeCompare(text(b.earliestExpiry || '9999-12-31')),
};

/**
 * Order a page of products. Returns a new array — callers may hold the input.
 * Array.prototype.sort is stable (ES2019), so ties keep their input order.
 */
export const sortProducts = (
    products: readonly Record<string, unknown>[],
    sortBy?: string,
): Record<string, unknown>[] =>
    [...products].sort(COMPARATORS[sortBy ?? 'name'] ?? COMPARATORS.name);

// ── Get single product ─────────────────────────────────────────────────────

const getProduct = async (uid: string, id: string): Promise<APIGatewayProxyResult> => {
    const result = await db.send(new GetCommand({ TableName: TABLE, Key: keys.product(uid, id) }));
    if (!result.Item) return notFound('NOT_FOUND', 'Product not found', { productId: id });
    return ok(stripKeys(result.Item));
};

// ── Add product ────────────────────────────────────────────────────────────

const addProduct = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = parseBody<Product>(event);
    if (!body) return badRequest('VALIDATION', 'Request body is required');

    const safe = stripTableKeys(body);
    const invalid = validateCatalogue(safe);
    if (invalid) return badRequest('VALIDATION', invalid);

    // A new catalogue entry has no stock. Stock arrives only via a purchase
    // invoice or the Excel importer's opening batches.
    const id   = typeof safe.id === 'string' && safe.id ? safe.id : randomUUID();
    const item = newProductItem({ uid, body: safe, id, now: new Date().toISOString() });

    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return created(stripKeys(item));
};

// ── Update product (catalogue fields only) ─────────────────────────────────

const updateProduct = async (uid: string, id: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = parseBody<Product>(event);
    if (!body) return badRequest('VALIDATION', 'Request body is required');

    // Read first: this is a full-item Put, so anything not carried over is
    // erased. The stored roll-ups must survive a catalogue edit untouched.
    const existing = await db.send(new GetCommand({ TableName: TABLE, Key: keys.product(uid, id) }));
    if (!existing.Item) return notFound('NOT_FOUND', 'Product not found', { productId: id });

    const safe = stripTableKeys(body);
    const invalid = validateCatalogue(safe);
    if (invalid) return badRequest('VALIDATION', invalid);

    const item = mergeProductItem({
        uid,
        existing: { ...existing.Item, id },
        body:     safe,
        now:      new Date().toISOString(),
    });

    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return ok(stripKeys(item));
};

// ── Delete product ─────────────────────────────────────────────────────────

// Batches and movements are intentionally left in place as history (blueprint
// §14 decision 2). They are unreachable from the catalogue but still answer
// "what happened to this stock", and a re-imported stockNo does not resurrect
// them because a new product gets a new id.
const deleteProduct = async (uid: string, id: string): Promise<APIGatewayProxyResult> => {
    await db.send(new DeleteCommand({ TableName: TABLE, Key: keys.product(uid, id) }));
    return noContent();
};

// ── Batches for one product ────────────────────────────────────────────────

const listProductBatches = async (
    uid: string,
    productId: string,
    event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
    const q = event.queryStringParameters ?? {};
    const includeEmpty = q.includeEmpty === '1' || q.includeEmpty === 'true';
    const pageSize     = Math.min(parseInt(q.limit ?? '200'), 500);
    const lastKey      = q.nextToken ? JSON.parse(Buffer.from(q.nextToken, 'base64').toString()) : undefined;

    const values: Record<string, unknown> = {
        ':pk':     `USER#${uid}`,
        ':prefix': `BATCH#${productId}#`,
    };
    const names: Record<string, string> = {};
    let filterExpression: string | undefined;

    // Emptied batches are kept as history (movements reference them) but hidden
    // by default so the picker and the valuation table stay readable.
    if (!includeEmpty) {
        filterExpression = '#qty > :zero';
        names['#qty']    = 'quantity';
        values[':zero']  = 0;
    }

    const result = await db.send(new QueryCommand({
        TableName:                 TABLE,
        KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression:          filterExpression,
        ExpressionAttributeValues: values,
        ExpressionAttributeNames:  Object.keys(names).length ? names : undefined,
        Limit:                     pageSize,
        ExclusiveStartKey:         lastKey,
        ScanIndexForward:          true,   // expiry is in the SK -> soonest first
    }));

    const batches = (result.Items ?? []).map(stripKeys);
    const nextToken = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null;

    return ok({ batches, nextToken });
};

// ── Bulk upsert (Excel import) ─────────────────────────────────────────────

const bulkUpsert = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // ONE deadline for the whole invocation. This handler makes TWO
    // batchWriteAll calls (creates, then updates); a fresh budget per call
    // would let the pair run past the 29s Lambda timeout while each looked
    // in-budget on its own. See lib/batch.ts.
    const deadline = Date.now() + BULK_DEADLINE_MS;

    const body = parseBody<{ products: Product[] }>(event);
    if (!body) return badRequest('VALIDATION', 'Request body is required');

    const rows = body.products;
    if (!Array.isArray(rows) || rows.length === 0) {
        return badRequest('VALIDATION', 'products array required');
    }
    if (rows.length > MAX_BULK_PRODUCTS) {
        return badRequest('VALIDATION', `bulk import limited to ${MAX_BULK_PRODUCTS} products per request`);
    }

    const planned = planBulkUpsert({
        uid,
        rows,
        existing: await loadAllProducts(uid),
        now:      new Date().toISOString(),
        newId:    randomUUID,
    });

    if ('error' in planned) {
        return badRequest('VALIDATION',
            `products[${planned.error.row}]: ${planned.error.message}`,
            { row: planned.error.row });
    }

    // Split so the counts stay honest under a partial write: batchWriteAll
    // reports how many items landed, not which, so creates and updates have to
    // be counted separately to be attributable at all.
    const createResult = await batchWriteAll(planned.creates, deadline);
    const updateResult = await batchWriteAll(planned.updates, deadline);

    const persisted = createResult.persisted + updateResult.persisted;

    return ok({
        imported:  createResult.persisted,
        updated:   updateResult.persisted,
        requested: rows.length,
        failed:    rows.length - persisted,
        timedOut:  createResult.timedOut || updateResult.timedOut,
    });
};

/**
 * Decide, for every row of an import, whether it creates or updates — and build
 * the write requests. Pure: no clock, no uuid, no DynamoDB.
 *
 * Every row is validated BEFORE any request is emitted, so a bad row at index
 * 40 cannot leave rows 0-39 already persisted. The first failure short-circuits
 * with its row index.
 */
export const planBulkUpsert = (input: {
    uid: string;
    rows: readonly Record<string, unknown>[];
    existing: readonly Record<string, unknown>[];
    now: string;
    newId: () => string;
}): { creates: WriteReq[]; updates: WriteReq[] } | { error: { row: number; message: string } } => {
    const { uid, rows, existing, now, newId } = input;

    // Existing catalogue, indexed by the normalized stockNo — the match key.
    const byStockNo = new Map<string, Record<string, unknown>>();
    for (const product of existing) {
        const stockNo = normalizeStockNo(product.stockNo);
        if (stockNo) byStockNo.set(stockNo, product);
    }

    const creates: WriteReq[] = [];
    const updates: WriteReq[] = [];
    const seenStockNos = new Set<string>();

    for (let row = 0; row < rows.length; row++) {
        const body = stripTableKeys(rows[row]);

        const invalid = validateCatalogue(body);
        if (invalid) return { error: { row, message: invalid } };

        const stockNo = normalizeStockNo(body.stockNo);

        // Two rows claiming one stockNo would be two writes to the same key in
        // one batch — DynamoDB rejects that outright, and even if it didn't the
        // second would silently win. Reject with the offending row instead.
        if (stockNo) {
            if (seenStockNos.has(stockNo)) {
                return { error: { row, message: `duplicate stockNo "${body.stockNo}" in this import` } };
            }
            seenStockNos.add(stockNo);
        }

        const match = stockNo ? byStockNo.get(stockNo) : undefined;

        if (match) {
            // An import re-prices the catalogue; it never moves stock.
            updates.push({ PutRequest: { Item: mergeProductItem({ uid, existing: match, body, now }) } });
        } else {
            const id = typeof body.id === 'string' && body.id ? body.id : newId();
            creates.push({ PutRequest: { Item: newProductItem({ uid, body, id, now }) } });
        }
    }

    return { creates, updates };
};

// ── Bulk delete ────────────────────────────────────────────────────────────

const bulkDelete = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const deadline = Date.now() + BULK_DEADLINE_MS;

    const body = parseBody<{ ids: string[] }>(event);
    if (!body) return badRequest('VALIDATION', 'Request body is required');
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
        return badRequest('VALIDATION', 'ids array required');
    }

    const requests: WriteReq[] = body.ids.map(id => ({ DeleteRequest: { Key: keys.product(uid, id) } }));
    const { persisted, timedOut } = await batchWriteAll(requests, deadline);

    return ok({ deleted: persisted, requested: body.ids.length, timedOut });
};

// ── Validation & normalization ─────────────────────────────────────────────

const PRICE_FIELDS = ['vp', 'retail', 'price25', 'price35', 'price42', 'price50'] as const;

/** Returns an error message, or null when the row is acceptable. */
export const validateCatalogue = (body: Record<string, unknown>): string | null => {
    if (typeof body.name !== 'string' || !body.name.trim()) {
        return 'name is required';
    }
    for (const field of PRICE_FIELDS) {
        const value = body[field];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            return `${field} must be a non-negative number`;
        }
    }
    const reorder = body.reorderLevel;
    if (reorder !== undefined && reorder !== null) {
        if (typeof reorder !== 'number' || !Number.isInteger(reorder) || reorder < 0) {
            return 'reorderLevel must be a non-negative whole number';
        }
    }
    if (body.stockNo !== undefined && body.stockNo !== null && typeof body.stockNo !== 'string') {
        return 'stockNo must be a string';
    }
    return null;
};

/**
 * Derived + defaulted catalogue fields, applied on every write path.
 *
 * Defaults exist so the frontend never has to guard: an imported row missing a
 * price renders as 0 rather than NaN, and a missing category lands in 'Other'
 * rather than breaking the filter dropdown.
 */
export const catalogueDefaults = (body: Record<string, unknown>): Record<string, unknown> => {
    const name = String(body.name ?? '').trim();
    const defaults: Record<string, unknown> = {
        name,
        nameLower:    name.toLowerCase(),
        category:     typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'Other',
        reorderLevel: typeof body.reorderLevel === 'number' ? body.reorderLevel : 0,
        // Display noun for quantities ("12 bottles"). Defaulted rather than left
        // absent so the UI can render it unconditionally.
        unit:         typeof body.unit === 'string' && body.unit.trim() ? body.unit.trim() : 'units',
    };
    for (const field of PRICE_FIELDS) {
        defaults[field] = typeof body[field] === 'number' ? body[field] : 0;
    }
    if (typeof body.stockNo === 'string' && body.stockNo.trim()) {
        defaults.stockNo = body.stockNo.trim();
    }
    return defaults;
};

// Match key for the upsert. Case- and whitespace-insensitive so "127k" from a
// hand-edited spreadsheet still updates the existing "127K" row rather than
// creating a duplicate.
export const normalizeStockNo = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toUpperCase();
    return trimmed || null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Every PRODUCT# row for a user, across pages. Used only by the bulk upsert. */
const loadAllProducts = async (uid: string): Promise<Record<string, unknown>[]> => {
    const products: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const result = await db.send(new QueryCommand({
            TableName:                 TABLE,
            KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': `USER#${uid}`, ':prefix': 'PRODUCT#' },
            ExclusiveStartKey:         lastKey,
        }));
        products.push(...(result.Items ?? []));
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return products;
};

// Date-only helpers live in lib/dates.ts (shared with batches.ts). Re-exported
// here so existing callers and tests keep their import path.
export { todayIso, addDaysIso };

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

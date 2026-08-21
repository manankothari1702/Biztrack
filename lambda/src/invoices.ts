import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import {
    BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand,
    TransactWriteCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys, type CounterType } from './lib/db';
import {
    ok, created, noContent, badRequest, notFound, conflict, serverError,
    unauthorized, tryGetUid, resolveCors,
} from './lib/response';
import { guardAccount } from './lib/accountGuard';
import { stripTableKeys } from './lib/sanitize';
import { isIsoDate, todayIso, DEFAULT_TIMEZONE } from './lib/dates';
import {
    applyStockChange, earliestExpiryOf, planInvoiceStock,
    type ProductSnapshot, type StockMovementRecord,
} from './lib/stock';

/**
 * Invoices — sales and purchases.
 *
 * This file owns three things the client is never trusted with: the invoice
 * NUMBER, every PRICE, and whether stock actually moved. A request supplies
 * intent only — which product, which lot, how many, at what tier, for whom.
 *
 * Shape follows products.ts and batches.ts: the decisions live in pure builders
 * that can be asserted directly, and the handler is the thin part that talks to
 * DynamoDB. The one addition is an injected `send` (see `Send`), because the
 * ORDER of the two writes is itself a correctness property — the counter must
 * be reserved before the transaction, never inside it — and order is only
 * observable if the seam can be watched.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type InvoiceType   = 'SALE' | 'PURCHASE';
export type InvoiceStatus = 'Draft' | 'Finalized' | 'Cancelled';
export type DiscountTier  = 0 | 25 | 35 | 42 | 50;

/** What the client may send per line. Everything else is computed here. */
export interface RequestLine {
    productId: string;
    expiryDate: string;
    quantity: number;
}

export interface InvoiceLine {
    productId: string;
    stockNo?: string;
    name: string;
    unitPrice: number;
    unitVp: number;
    quantity: number;
    lineAmount: number;
    lineVp: number;
    expiryDate: string;
    /** = product.price50. INTERNAL — never rendered on a SALE bill. */
    unitCost?: number;
}

export interface Invoice {
    id: string;
    type: InvoiceType;
    invoiceNo: string;
    date: string;
    tier: DiscountTier;
    partyName: string;
    partyPhone?: string;
    partyEmail?: string;
    partyAddress?: string;
    lines: InvoiceLine[];
    totalAmount: number;
    totalVp: number;
    totalCost?: number;
    status: InvoiceStatus;
    stockApplied: boolean;
    notes?: string;
    invDate?: string;
    createdAt: string;
    updatedAt?: string;
    [key: string]: unknown;
}

/** A catalogue row, as far as pricing is concerned. */
export interface CatalogueProduct {
    id: string;
    name: string;
    stockNo?: string;
    vp: number;
    retail: number;
    price25: number;
    price35: number;
    price42: number;
    price50: number;
    earliestExpiry?: string;
    [key: string]: unknown;
}

/**
 * The DynamoDB seam, injected.
 *
 * `db.send` in production; a recorder in tests. This exists so "the counter is
 * reserved BEFORE the transaction" is a property a test can assert, rather than
 * a comment asking the next reader to take it on faith.
 */
export type Send = (command: unknown) => Promise<Record<string, unknown>>;

const liveSend: Send = (command) =>
    db.send(command as Parameters<typeof db.send>[0]) as Promise<Record<string, unknown>>;

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * DynamoDB caps a transaction at 100 items. Finalizing writes
 * `1 invoice + lines×2 (batch + movement) + distinct products×1 (roll-up)`,
 * so 30 lines is at most 91 — comfortably inside, with the invoice `Put`
 * declared to the engine via `reservedItems`. (TRD §5.)
 */
export const MAX_INVOICE_LINES = 30;

const TIERS: readonly DiscountTier[] = [0, 25, 35, 42, 50];

/** The catalogue field each tier prices from. 0% is Retail, not MRP (PRD §6). */
const TIER_FIELD: Record<DiscountTier, keyof CatalogueProduct> = {
    0: 'retail', 25: 'price25', 35: 'price35', 42: 'price42', 50: 'price50',
};

/** A purchase is always bought at 50% — that is the user's cost. */
const PURCHASE_TIER: DiscountTier = 50;

/**
 * Round a VP figure to 2dp. Applied ONCE to a total, never per line before
 * summing — rounding each line first compounds the error, and the monthly
 * volume figure has to reconcile with Herbalife's.
 */
export const roundVp = (vp: number): number => Math.round(vp * 100) / 100;

// ── Handler ────────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        resolveCors(event);
        const uid = tryGetUid(event);
        if (!uid) return unauthorized();

        const { blocked, profile } = await guardAccount(uid);
        if (blocked) return blocked;

        const method   = event.httpMethod;
        const id       = event.pathParameters?.id;
        const path     = event.resource ?? event.path;
        const timeZone = timezoneOf(profile);
        const common   = { uid, now: new Date().toISOString(), newId: randomUUID, send: liveSend };

        // Sub-paths first — /finalize and /cancel also carry an id, so they
        // would otherwise be swallowed by the routes below (clients.ts does the
        // same for /bulk).
        if (path.endsWith('/finalize')) {
            if (method === 'POST' && id) return await finalizeInvoice({ ...common, id });
        }
        if (path.endsWith('/cancel')) {
            if (method === 'POST' && id) return await cancelInvoice({ ...common, id });
        }

        if (method === 'POST' && !id) {
            const q = event.queryStringParameters ?? {};
            return await createInvoice({
                ...common,
                body:     parseBody(event),
                // Absent means finalize — the app's normal path is "record what
                // happened", and a draft is the deliberate exception.
                finalize: q.finalize !== 'false',
                timeZone,
            });
        }

        if (method === 'GET'    && !id) return await listInvoices({ uid, event, send: liveSend });
        if (method === 'GET'    &&  id) return await getInvoice(uid, id, liveSend);
        if (method === 'PUT'    &&  id) return await updateInvoice({ ...common, id, body: parseBody(event) });
        if (method === 'DELETE' &&  id) return await deleteInvoice(uid, id, liveSend);

        return badRequest('VALIDATION', 'Unknown route');
    } catch (err) {
        return serverError(err);
    }
};

const timezoneOf = (profile: Record<string, unknown> | null): string =>
    typeof profile?.timezone === 'string' && profile.timezone ? profile.timezone : DEFAULT_TIMEZONE;

// ── Create ─────────────────────────────────────────────────────────────────

export interface CreateInvoiceInput {
    uid: string;
    body: unknown;
    finalize: boolean;
    timeZone: string;
    now: string;
    newId: () => string;
    send: Send;
    /**
     * The document's calendar date, and the year the counter resets on.
     * Injected like `now` so numbering is deterministic under test; defaults to
     * today in the user's timezone.
     */
    today?: string;
}

/**
 * `POST /invoices`.
 *
 * The write order is load → reserve number → commit, and it is deliberate:
 *
 *  1. Products are read first so an unknown id fails with a 400 having written
 *     nothing at all — not even a burned invoice number.
 *  2. The counter is reserved SECOND, alone, outside the transaction. It cannot
 *     go inside: `ADD seq :1` has to return the new value to build the number
 *     that the invoice item itself carries, and a transaction returns no
 *     attributes. So the number is spent before the transaction is attempted,
 *     and a failed transaction leaves a GAP. That is intended (TRD §5) — a
 *     reused number is far worse than a missing one.
 *  3. The transaction commits invoice + batches + roll-ups + movements together.
 */
export const createInvoice = async (input: CreateInvoiceInput): Promise<APIGatewayProxyResult> => {
    const { uid, finalize, timeZone, now, newId, send } = input;

    const parsed = validateCreateBody(input.body);
    if ('error' in parsed) {
        return badRequest(parsed.error.code, parsed.error.message, parsed.error.extra);
    }
    const request = parsed.value;

    // ── 1. Catalogue ────────────────────────────────────────────────────────
    const productIds = [...new Set(request.lines.map(l => l.productId))];
    const products   = await loadProducts(uid, productIds, send);

    const missing = productIds.filter(id => !products[id]);
    if (missing.length) {
        return badRequest('VALIDATION',
            `Unknown product${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
            { productIds: missing });
    }

    // ── 2. Invoice number — BEFORE the transaction, on purpose ──────────────
    const date = input.today ?? todayIso(timeZone);
    const year = Number(date.slice(0, 4));
    const { seq } = await reserveInvoiceNo(uid, request.type, year, send);
    const invoiceNo = formatInvoiceNo(request.type, year, seq);

    // ── 3. Build ────────────────────────────────────────────────────────────
    const invoice = priceInvoice({ request, products, invoiceNo, date, now, finalize });

    return commitInvoice({
        uid, invoice, products, now, newId, send,
        moveStock: finalize,
        // THE idempotency guard. A retried submit — same client-generated id —
        // collides here and the whole transaction cancels, so a double-tap can
        // never deduct stock twice.
        guard: { ConditionExpression: 'attribute_not_exists(PK)' },
        onGuardFail: () => conflict('DUPLICATE',
            'An invoice with this id already exists — fetch it instead of retrying',
            { id: invoice.id, invoiceNo: invoice.invoiceNo }),
        respond: created,
    });
};

// ── The one commit path ────────────────────────────────────────────────────

interface CommitInput {
    uid: string;
    invoice: Invoice;
    products: Readonly<Record<string, CatalogueProduct>>;
    now: string;
    newId: () => string;
    send: Send;
    /** Build and apply the stock plan. False for a Draft, which moves nothing. */
    moveStock: boolean;
    /** Reverse the stock direction — cancellation. */
    reverse?: boolean;
    /** Condition on the invoice `Put`, and what a failure of it means. */
    guard: {
        ConditionExpression: string;
        ExpressionAttributeNames?: Record<string, string>;
        ExpressionAttributeValues?: Record<string, unknown>;
    };
    onGuardFail: () => APIGatewayProxyResult;
    respond: (body: unknown) => APIGatewayProxyResult;
    /** See `mapTransactionFailure`. Reversal reports the same guard differently. */
    stockFailCode?: 'INSUFFICIENT_STOCK' | 'STOCK_ALREADY_SOLD';
}

/**
 * Write an invoice and its stock together, or write nothing.
 *
 * Create, finalize and cancel ALL come through here. That is what makes
 * `POST /invoices?finalize=true` and `POST /invoices/{id}/finalize` identical
 * rather than merely intended to be identical: they differ in the guard on the
 * invoice `Put` and in nothing else. Three near-copies of this would be three
 * places for the transaction shape to drift.
 *
 * The invoice `Put` is always item 0, so `CancellationReasons[0]` is
 * unambiguously the invoice guard and every later index belongs to the stock
 * plan, in the order the engine emitted it.
 */
const commitInvoice = async (input: CommitInput): Promise<APIGatewayProxyResult> => {
    const { uid, invoice, products, now, newId, send, moveStock, reverse, guard } = input;

    const plan = moveStock
        ? applyStockChange({
            uid,
            changes: planInvoiceStock({
                type:      invoice.type,
                invoiceNo: invoice.invoiceNo,
                lines:     invoice.lines.map(l => ({
                    productId: l.productId, name: l.name,
                    quantity:  l.quantity,  expiryDate: l.expiryDate,
                })),
            }, { reverse }),
            products: snapshots(products),
            now,
            newId,
            reservedItems: 1,          // the invoice Put, below
        })
        : { items: [], movements: [] as StockMovementRecord[], productsNeedingExpiryRecompute: [] };

    const items = [
        {
            Put: {
                TableName: TABLE,
                Item: { ...invoice, ...keys.invoice(uid, invoice.id) },   // keys MUST win
                ...guard,
            },
        },
        ...plan.items,
    ];

    try {
        await send(new TransactWriteCommand({ TransactItems: items }));
    } catch (err) {
        const mapped = await mapTransactionFailure(
            err, uid, plan.items, invoice, send, input.onGuardFail, input.stockFailCode);
        if (mapped) return mapped;
        throw err;
    }

    // A decrement (a SALE, or a PURCHASE cancellation) can empty the earliest
    // lot and push the true minimum LATER — which a transaction cannot see,
    // because it cannot contain a query. So recompute AFTER the commit, exactly
    // as batches.ts does. Omitting this is what left earliestExpiry pointing at
    // an emptied lot in the first live run.
    await recomputeEarliestExpiry(uid, plan.productsNeedingExpiryRecompute, now, send);

    return input.respond(stripKeys(invoice));
};

/**
 * Refresh `product.earliestExpiry` from its batches, after stock left one.
 *
 * The mirror of `batches.ts::recomputeEarliestExpiry`, driven through the same
 * injected `send` seam so it is testable. Best-effort by design: a failure
 * leaves the cache pointing EARLIER than the truth, which only makes an alert
 * fire sooner — never later. `earliestExpiryOf` (the actual min-over-non-zero
 * logic) is shared from lib/stock.ts, so only the query/update plumbing lives
 * here, and it cannot disagree with the batch handler about what "earliest"
 * means.
 */
const recomputeEarliestExpiry = async (
    uid: string,
    productIds: readonly string[],
    now: string,
    send: Send,
): Promise<void> => {
    for (const productId of productIds) {
        try {
            const batches: { expiryDate: string; quantity: number }[] = [];
            let lastKey: Record<string, unknown> | undefined;
            do {
                const res = await send(new QueryCommand({
                    TableName:                 TABLE,
                    KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
                    ExpressionAttributeValues: { ':pk': `USER#${uid}`, ':prefix': `BATCH#${productId}#` },
                    ExclusiveStartKey:         lastKey,
                }));
                for (const item of (res.Items as Record<string, unknown>[] | undefined) ?? []) {
                    batches.push({ expiryDate: String(item.expiryDate), quantity: Number(item.quantity ?? 0) });
                }
                lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
            } while (lastKey);

            const earliest = earliestExpiryOf(batches);
            await send(new UpdateCommand({
                TableName: TABLE,
                Key:       keys.product(uid, productId),
                ...(earliest
                    ? {
                        UpdateExpression:          'SET earliestExpiry = :e, updatedAt = :now',
                        ExpressionAttributeValues: { ':e': earliest, ':now': now },
                      }
                    : {
                        // No stock left anywhere — drop the attribute rather than
                        // leave a date pointing at an emptied lot.
                        UpdateExpression:          'REMOVE earliestExpiry SET updatedAt = :now',
                        ExpressionAttributeValues: { ':now': now },
                      }),
            }));
        } catch (err) {
            console.error(JSON.stringify({
                level: 'warn', event: 'earliest_expiry_recompute_failed',
                uid, productId, message: err instanceof Error ? err.message : String(err),
            }));
        }
    }
};

// ── Read & list ────────────────────────────────────────────────────────────

/** `GET /invoices/{id}` — a point read; the id alone is the key (Data Model §4). */
export const getInvoice = async (uid: string, id: string, send: Send): Promise<APIGatewayProxyResult> => {
    const res = await send(new GetCommand({ TableName: TABLE, Key: keys.invoice(uid, id) }));
    if (!res.Item) return notFound('NOT_FOUND', 'Invoice not found', { id });
    return ok(stripKeys(res.Item as Record<string, unknown>));
};

const INVOICE_PREFIX = 'INVOICE#';
const INVOICE_STATUSES: readonly InvoiceStatus[] = ['Draft', 'Finalized', 'Cancelled'];
const EXPIRY_INDEX = 'GSI6-InventoryDate';

export interface ListInvoicesInput {
    uid: string;
    event: APIGatewayProxyEvent;
    send: Send;
}

/** How many index chunks one list call will scan before giving up (safety bound). */
const MAX_LIST_SCAN_CHUNKS = 50;
/** Index rows read per internal query — larger than pageSize to skip batch rows in bulk. */
const LIST_SCAN_CHUNK = 200;

/**
 * `GET /invoices` — newest-first, via GSI6-InventoryDate.
 *
 * The catch this endpoint has to handle: batches SHARE GSI6 (they write
 * `invDate = expiryDate`, invoices write `invDate = createdAt`), and a batch's
 * future expiry date sorts LEXICALLY ABOVE a recent invoice timestamp
 * (`2028-06-30` > `2026-07-23T…`). Descending, that puts nearly every batch
 * ahead of every invoice. DynamoDB applies `Limit` to rows READ before the
 * `begins_with(SK,'INVOICE#')` filter runs, so a single `Limit=50` query on a
 * shop with dozens of batches comes back with ZERO invoices and a continuation
 * token — the first live run hit exactly that, and a non-paginating caller saw
 * an empty list.
 *
 * So this keeps scanning the index internally until it has a full page of real
 * invoices (or the safety bound trips), and paginates on the LAST RETURNED
 * INVOICE's own key rather than the raw index cursor. That makes each page a
 * clean slice of invoices no matter how many batch rows interleave.
 */
export const listInvoices = async (input: ListInvoicesInput): Promise<APIGatewayProxyResult> => {
    const { uid, event, send } = input;
    const q = event.queryStringParameters ?? {};

    // Parse, THEN clamp — not `parseInt(...) || 50`, which would fold an
    // explicit `limit=0` into the default 50 instead of clamping it to the
    // floor. Only a non-numeric limit falls back to 50; a numeric one is
    // clamped to [1, 200].
    const requested = parseInt(q.limit ?? '', 10);
    const pageSize  = Math.min(Math.max(Number.isNaN(requested) ? 50 : requested, 1), 200);
    const startKey  = q.nextToken
        ? JSON.parse(Buffer.from(q.nextToken, 'base64').toString())
        : undefined;

    const values: Record<string, unknown> = { ':pk': `USER#${uid}`, ':prefix': INVOICE_PREFIX };
    const names:  Record<string, string>  = {};
    const filterParts = ['begins_with(SK, :prefix)'];

    // from/to windows the SORT KEY (invDate), so only rows in range are read.
    // `to` is pushed to end-of-day: a bare date would stop at 00:00 and miss
    // everything created later that day.
    let keyCondition = 'PK = :pk';
    if (q.from && q.to) {
        keyCondition = 'PK = :pk AND invDate BETWEEN :from AND :to';
        values[':from'] = q.from;
        values[':to']   = endOfDay(q.to);
    } else if (q.from) {
        keyCondition = 'PK = :pk AND invDate >= :from';
        values[':from'] = q.from;
    } else if (q.to) {
        keyCondition = 'PK = :pk AND invDate <= :to';
        values[':to'] = endOfDay(q.to);
    }

    if (q.type === 'SALE' || q.type === 'PURCHASE') {
        filterParts.push('#type = :type');
        names['#type']  = 'type';      // reserved word
        values[':type'] = q.type;
    }

    if (q.status && INVOICE_STATUSES.includes(q.status as InvoiceStatus)) {
        filterParts.push('#status = :status');
        names['#status']  = 'status';  // reserved word
        values[':status'] = q.status;
    }

    const collected: Record<string, unknown>[] = [];
    let cursor: Record<string, unknown> | undefined = startKey;
    let chunks = 0;

    // Read index chunks until a full page of invoices is in hand, the index is
    // exhausted, or the safety bound trips.
    do {
        const res = await send(new QueryCommand({
            TableName:                 TABLE,
            IndexName:                 EXPIRY_INDEX,
            KeyConditionExpression:    keyCondition,
            FilterExpression:          filterParts.join(' AND '),
            ExpressionAttributeValues: values,
            ExpressionAttributeNames:  Object.keys(names).length ? names : undefined,
            Limit:                     LIST_SCAN_CHUNK,
            ExclusiveStartKey:         cursor,
            ScanIndexForward:          false,     // invDate descending -> newest first
        }));
        for (const item of (res.Items as Record<string, unknown>[] | undefined) ?? []) collected.push(item);
        cursor = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        chunks++;
    } while (cursor && collected.length < pageSize && chunks < MAX_LIST_SCAN_CHUNKS);

    const page = collected.slice(0, pageSize);

    // Resume from the last INVOICE returned, not the index cursor — so the next
    // page continues cleanly after it regardless of interleaved batches. A GSI
    // ExclusiveStartKey needs the base-table key (PK, SK) AND the index key
    // (invDate); all three are projected (ProjectionType.ALL).
    let nextToken: string | null = null;
    if (collected.length > pageSize) {
        const last = page[page.length - 1];
        nextToken = Buffer.from(JSON.stringify({ PK: last.PK, SK: last.SK, invDate: last.invDate })).toString('base64');
    } else if (cursor) {
        // Page not filled but the index isn't exhausted (the scan bound tripped):
        // hand back the raw index cursor so the client can continue.
        nextToken = Buffer.from(JSON.stringify(cursor)).toString('base64');
    }

    return ok({ invoices: page.map(stripKeys), nextToken });
};

/** `2026-07-23` → `2026-07-23T23:59:59.999Z`, so a `to` date includes its whole day. */
const endOfDay = (date: string): string =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59.999Z` : date;

// ── Update (Draft only) ────────────────────────────────────────────────────

interface MutateByIdInput {
    uid: string;
    id: string;
    now: string;
    newId: () => string;
    send: Send;
}

/**
 * `PUT /invoices/{id}` — edit a Draft in place.
 *
 * Finalized and Cancelled invoices are immutable: a finalized invoice has moved
 * stock, so changing its lines would desync the roll-ups it already wrote. The
 * status is re-read and checked HERE rather than trusted from the body — the
 * client cannot talk its way past the gate by sending `status: 'Draft'`.
 *
 * A Draft has never touched stock, so this is a plain `Put`; no transaction, no
 * numbering (the draft keeps the number it was given).
 */
export const updateInvoice = async (
    input: MutateByIdInput & { body: unknown },
): Promise<APIGatewayProxyResult> => {
    const { uid, id, now, send } = input;

    const existing = await loadInvoice(uid, id, send);
    if (!existing) return notFound('NOT_FOUND', 'Invoice not found', { id });
    if (existing.status !== 'Draft') {
        return conflict('NOT_DRAFT',
            `Only a Draft can be edited; this invoice is ${existing.status}. Cancel it instead.`,
            { id, status: existing.status });
    }

    const parsed = validateCreateBody(input.body);
    if ('error' in parsed) {
        return badRequest(parsed.error.code, parsed.error.message, parsed.error.extra);
    }
    const request = parsed.value;

    const productIds = [...new Set(request.lines.map(l => l.productId))];
    const products   = await loadProducts(uid, productIds, send);
    const missing    = productIds.filter(pid => !products[pid]);
    if (missing.length) {
        return badRequest('VALIDATION',
            `Unknown product${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
            { productIds: missing });
    }

    // Re-price from the CURRENT catalogue, but keep the invoice's IDENTITY —
    // its number, id, type and creation time. A PUT re-costs a draft; it never
    // renumbers it or changes what kind of document it is. The body's type is
    // ignored in favour of the stored one.
    const repriced = priceInvoice({
        request:   { ...request, id, type: existing.type, tier: existing.type === 'PURCHASE' ? 50 : request.tier },
        products,
        invoiceNo: existing.invoiceNo,
        date:      existing.date,
        now:       existing.createdAt,          // preserve the original creation instant / invDate
        finalize:  false,
    });
    repriced.updatedAt = now;

    // Guarded so a finalize landing between the read above and this write cannot
    // be silently reverted to a Draft — the PUT only lands while still a Draft.
    try {
        await send(new PutCommand({
            TableName: TABLE,
            Item: { ...repriced, ...keys.invoice(uid, id) },
            ConditionExpression:       'attribute_exists(PK) AND #status = :draft',
            ExpressionAttributeNames:  { '#status': 'status' },
            ExpressionAttributeValues: { ':draft': 'Draft' },
        }));
    } catch (err) {
        if (isConditionalFailure(err)) {
            return conflict('NOT_DRAFT',
                'This invoice was finalized before the edit could be saved', { id });
        }
        throw err;
    }

    return ok(stripKeys(repriced));
};

// ── Finalize (Draft -> Finalized) ──────────────────────────────────────────

/**
 * `POST /invoices/{id}/finalize`.
 *
 * A draft is a promise to move stock later; finalize is when it actually moves.
 * The world may have shifted since the draft was written — the catalogue
 * repriced, the batch emptied by another sale — so this RE-READS products and
 * RE-PRICES from scratch, then applies stock through the exact same
 * `commitInvoice` path as create. The draft's stored prices are treated as
 * stale and discarded.
 *
 * The Draft gate is enforced inside the transaction, not just by the read
 * above: `#status = :draft` on the invoice Put means a concurrent finalize of
 * the same draft cancels rather than moving stock twice. That is the finalize
 * analogue of create's idempotency guard.
 */
export const finalizeInvoice = async (input: MutateByIdInput): Promise<APIGatewayProxyResult> => {
    const { uid, id, now, newId, send } = input;

    const existing = await loadInvoice(uid, id, send);
    if (!existing) return notFound('NOT_FOUND', 'Invoice not found', { id });
    if (existing.status !== 'Draft') {
        return conflict('NOT_DRAFT',
            `Only a Draft can be finalized; this invoice is ${existing.status}`,
            { id, status: existing.status });
    }

    const productIds = [...new Set(existing.lines.map(l => l.productId))];
    const products   = await loadProducts(uid, productIds, send);
    const missing    = productIds.filter(pid => !products[pid]);
    if (missing.length) {
        // A product deleted since the draft was written. Nothing is priced or
        // moved — the draft stays a draft.
        return badRequest('VALIDATION',
            `Cannot finalize: product${missing.length > 1 ? 's' : ''} no longer in the catalogue: ${missing.join(', ')}`,
            { productIds: missing });
    }

    // Re-price at finalize time against the CURRENT catalogue.
    const repriced = priceInvoice({
        request: {
            id, type: existing.type, tier: existing.tier,
            partyName:    existing.partyName,
            partyPhone:   existing.partyPhone,
            partyEmail:   existing.partyEmail,
            partyAddress: existing.partyAddress,
            notes:        existing.notes,
            lines:        existing.lines.map(l => ({
                productId: l.productId, expiryDate: l.expiryDate, quantity: l.quantity,
            })),
        },
        products,
        invoiceNo: existing.invoiceNo,
        date:      existing.date,
        now:       existing.createdAt,       // keep the original creation instant
        finalize:  true,
    });
    repriced.updatedAt = now;

    return commitInvoice({
        uid, invoice: repriced, products, now, newId, send,
        moveStock: true,
        // The Put REPLACES the draft, guarded so it only lands while still a
        // Draft — a racing finalize hits this and cancels.
        guard: {
            ConditionExpression:       '#status = :draft',
            ExpressionAttributeNames:  { '#status': 'status' },
            ExpressionAttributeValues: { ':draft': 'Draft' },
        },
        onGuardFail: () => conflict('NOT_DRAFT',
            'This invoice was already finalized or cancelled', { id }),
        respond: ok,
    });
};

// ── Cancel (reverse stock) ─────────────────────────────────────────────────

/**
 * `POST /invoices/{id}/cancel`.
 *
 * Reverses the stock a finalized invoice moved: a SALE adds its units back, a
 * PURCHASE removes the ones it brought in. Built by `planInvoiceStock(...,
 * { reverse: true })`, so the direction table lives in one place and cancel
 * cannot drift from create.
 *
 * Two guards, both load-bearing:
 *  - `#status = :finalized` on the invoice Put. Only a Finalized invoice can be
 *    cancelled, and the condition is what stops a DOUBLE cancel from reversing
 *    twice — the second attempt finds status already Cancelled and the whole
 *    transaction cancels, adding nothing back.
 *  - The engine's own decrement guard on each batch, inherited for free by a
 *    PURCHASE reversal. If those units have since been sold the condition fails
 *    and the caller sees 409 STOCK_ALREADY_SOLD — reported from
 *    CancellationReasons, so it names the exact lot.
 */
export const cancelInvoice = async (input: MutateByIdInput): Promise<APIGatewayProxyResult> => {
    const { uid, id, now, newId, send } = input;

    const existing = await loadInvoice(uid, id, send);
    if (!existing) return notFound('NOT_FOUND', 'Invoice not found', { id });

    if (existing.status === 'Cancelled') {
        return conflict('ALREADY_CANCELLED', 'This invoice is already cancelled', { id });
    }
    if (existing.status !== 'Finalized') {
        // A Draft never moved stock, so there is nothing to reverse — delete it.
        return conflict('NOT_FINALIZED',
            'Only a finalized invoice can be cancelled; delete a draft instead',
            { id, status: existing.status });
    }

    const productIds = [...new Set(existing.lines.map(l => l.productId))];
    const products   = await loadProducts(uid, productIds, send);

    const cancelled: Invoice = {
        ...existing,
        status:       'Cancelled',
        stockApplied: false,
        updatedAt:    now,
    };

    return commitInvoice({
        uid, invoice: cancelled, products, now, newId, send,
        moveStock: true,
        reverse:   true,
        guard: {
            ConditionExpression:       '#status = :finalized',
            ExpressionAttributeNames:  { '#status': 'status' },
            ExpressionAttributeValues: { ':finalized': 'Finalized' },
        },
        onGuardFail: () => conflict('NOT_FINALIZED',
            'This invoice is no longer finalized — it may have been cancelled already', { id }),
        // A failed BATCH guard on a reversal means the stock is gone.
        stockFailCode: 'STOCK_ALREADY_SOLD',
        respond: ok,
    });
};

// ── Delete (Draft only) ────────────────────────────────────────────────────

/**
 * `DELETE /invoices/{id}` — Draft only.
 *
 * A finalized invoice moved stock and is part of the audit trail; it is
 * cancelled, never deleted. The `attribute_exists` + `#status = :draft`
 * condition enforces that atomically, so a finalize landing between the read
 * and the delete cannot erase a now-finalized invoice.
 */
export const deleteInvoice = async (uid: string, id: string, send: Send): Promise<APIGatewayProxyResult> => {
    const existing = await loadInvoice(uid, id, send);
    if (!existing) return notFound('NOT_FOUND', 'Invoice not found', { id });
    if (existing.status !== 'Draft') {
        return conflict('NOT_DRAFT',
            `Only a Draft can be deleted; this invoice is ${existing.status}. Cancel it instead.`,
            { id, status: existing.status });
    }

    try {
        await send(new DeleteCommand({
            TableName: TABLE,
            Key: keys.invoice(uid, id),
            ConditionExpression:       'attribute_exists(PK) AND #status = :draft',
            ExpressionAttributeNames:  { '#status': 'status' },
            ExpressionAttributeValues: { ':draft': 'Draft' },
        }));
    } catch (err) {
        if (isConditionalFailure(err)) {
            return conflict('NOT_DRAFT',
                'This invoice was finalized before it could be deleted; cancel it instead', { id });
        }
        throw err;
    }

    return noContent();
};

// ── Loads ──────────────────────────────────────────────────────────────────

const loadInvoice = async (uid: string, id: string, send: Send): Promise<Invoice | null> => {
    const res = await send(new GetCommand({ TableName: TABLE, Key: keys.invoice(uid, id) }));
    return (res.Item as Invoice | undefined) ?? null;
};

// ── Validation (pure) ──────────────────────────────────────────────────────

export interface ParsedCreate {
    id: string;
    type: InvoiceType;
    tier: DiscountTier;
    partyName: string;
    partyPhone?: string;
    partyEmail?: string;
    partyAddress?: string;
    notes?: string;
    lines: RequestLine[];
}

type Failure = { error: { code: string; message: string; extra?: Record<string, unknown> } };

const fail = (code: string, message: string, extra?: Record<string, unknown>): Failure =>
    ({ error: { code, message, extra } });

/**
 * Accept a request body, or say precisely why not.
 *
 * Reads ONLY intent: product, lot, quantity, tier, party. Any `unitPrice`,
 * `lineAmount`, `totalAmount`, `invoiceNo` or `status` in the body is dropped
 * on the floor here — not rejected, dropped — because the client legitimately
 * round-trips whole Invoice objects it was given, and rejecting would break
 * that for no gain. The server recomputes all of it downstream regardless.
 */
export const validateCreateBody = (body: unknown): { value: ParsedCreate } | Failure => {
    if (!body || typeof body !== 'object') {
        return fail('VALIDATION', 'Request body is required');
    }
    const raw = stripTableKeys(body as Record<string, unknown>);

    const type = raw.type;
    if (type !== 'SALE' && type !== 'PURCHASE') {
        return fail('VALIDATION', 'type must be SALE or PURCHASE');
    }

    if (typeof raw.partyName !== 'string' || !raw.partyName.trim()) {
        return fail('VALIDATION',
            type === 'SALE' ? 'partyName (the customer) is required'
                            : 'partyName (the supplier) is required');
    }

    const lines = raw.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
        return fail('VALIDATION', 'lines must be a non-empty array');
    }

    // Checked BEFORE anything is built, and before the counter is touched, so an
    // oversized invoice cannot burn a number on its way to a 400.
    if (lines.length > MAX_INVOICE_LINES) {
        return fail('TOO_MANY_LINES',
            `An invoice may have at most ${MAX_INVOICE_LINES} lines; this one has ${lines.length}`,
            { limit: MAX_INVOICE_LINES, received: lines.length });
    }

    // A PURCHASE is always bought at 50%; only a SALE carries a chosen tier.
    let tier: DiscountTier;
    if (type === 'PURCHASE') {
        tier = PURCHASE_TIER;
    } else {
        const requested = raw.tier;
        if (!TIERS.includes(requested as DiscountTier)) {
            return fail('VALIDATION', `tier must be one of: ${TIERS.join(', ')}`, { allowed: TIERS });
        }
        tier = requested as DiscountTier;
    }

    const parsedLines: RequestLine[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] as Record<string, unknown>;
        if (!line || typeof line !== 'object') {
            return fail('VALIDATION', `lines[${i}] must be an object`, { line: i });
        }
        if (typeof line.productId !== 'string' || !line.productId) {
            return fail('VALIDATION', `lines[${i}].productId is required`, { line: i });
        }
        if (!isIsoDate(line.expiryDate)) {
            return fail('VALIDATION',
                `lines[${i}].expiryDate must be a real calendar date in YYYY-MM-DD form`, { line: i });
        }
        if (typeof line.quantity !== 'number'
            || !Number.isInteger(line.quantity) || line.quantity <= 0) {
            return fail('VALIDATION',
                `lines[${i}].quantity must be a whole number of at least 1`, { line: i });
        }
        parsedLines.push({
            productId:  line.productId,
            expiryDate: line.expiryDate,
            quantity:   line.quantity,
        });
    }

    return {
        value: {
            // Client-generated so a retry is recognisable. Absent is allowed —
            // the caller simply forfeits idempotency for that submit.
            id:           typeof raw.id === 'string' && raw.id ? raw.id : randomUUID(),
            type,
            tier,
            partyName:    raw.partyName.trim(),
            partyPhone:   optionalText(raw.partyPhone),
            partyEmail:   optionalText(raw.partyEmail),
            partyAddress: optionalText(raw.partyAddress),
            notes:        optionalText(raw.notes),
            lines:        type === 'PURCHASE' ? mergePurchaseLines(parsedLines) : parsedLines,
        },
    };
};

const optionalText = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * Collapse duplicate `(productId, expiryDate)` lines on a PURCHASE.
 *
 * Two lines of one shipment at one expiry are the same batch row, and a
 * transaction that touched it twice would be rejected outright by DynamoDB.
 * The engine would aggregate the stock change anyway, but the INVOICE would
 * still show two lines for one lot — so the merge happens here, on the stored
 * document, and the two stay consistent.
 *
 * SALE lines are deliberately left alone: selling the same lot twice on one
 * bill is a legitimate way to record two picks, each earning its own movement.
 */
export const mergePurchaseLines = (lines: readonly RequestLine[]): RequestLine[] => {
    const byKey = new Map<string, RequestLine>();
    for (const line of lines) {
        const key = `${line.productId}#${line.expiryDate}`;
        const seen = byKey.get(key);
        if (seen) seen.quantity += line.quantity;      // first position is kept
        else byKey.set(key, { ...line });
    }
    return [...byKey.values()];
};

// ── Pricing (pure) ─────────────────────────────────────────────────────────

/**
 * Build the stored invoice, pricing every line from the CATALOGUE.
 *
 * Every price on the result is a snapshot taken now, so a later repricing of
 * the catalogue leaves historical invoices untouched. Nothing here reads a
 * price off the request: the client's numbers were already discarded by
 * `validateCreateBody`, and this is the only place prices come from.
 */
export const priceInvoice = (input: {
    request: ParsedCreate;
    products: Readonly<Record<string, CatalogueProduct>>;
    invoiceNo: string;
    date: string;
    now: string;
    finalize: boolean;
}): Invoice => {
    const { request, products, invoiceNo, date, now, finalize } = input;

    const priceField = TIER_FIELD[request.tier];

    let totalAmount = 0;
    let rawVp       = 0;
    let totalCost   = 0;

    const lines: InvoiceLine[] = request.lines.map(line => {
        const product   = products[line.productId];
        const unitPrice = numberOf(product[priceField]);
        const unitVp    = numberOf(product.vp);
        const unitCost  = numberOf(product.price50);

        const lineAmount = unitPrice * line.quantity;
        const lineVp     = unitVp * line.quantity;

        totalAmount += lineAmount;
        rawVp       += lineVp;              // summed RAW; rounded once below
        totalCost   += unitCost * line.quantity;

        return {
            productId:  line.productId,
            stockNo:    typeof product.stockNo === 'string' ? product.stockNo : undefined,
            name:       product.name,
            unitPrice,
            unitVp,
            quantity:   line.quantity,
            lineAmount,
            lineVp,
            expiryDate: line.expiryDate,
            // Cost is what makes a SALE's margin computable. A PURCHASE is
            // bought at 50%, so unitPrice already IS the cost and repeating it
            // would only invite the two to disagree later.
            ...(request.type === 'SALE' ? { unitCost } : {}),
        };
    });

    return {
        id:           request.id,
        type:         request.type,
        invoiceNo,
        date,
        tier:         request.tier,
        partyName:    request.partyName,
        partyPhone:   request.partyPhone,
        partyEmail:   request.partyEmail,
        partyAddress: request.partyAddress,
        lines,
        totalAmount,
        totalVp:      roundVp(rawVp),
        ...(request.type === 'SALE' ? { totalCost } : {}),
        status:       finalize ? 'Finalized' : 'Draft',
        stockApplied: finalize,
        notes:        request.notes,
        // GSI6-InventoryDate sort key. Batches write the EXPIRY here; invoices
        // write the creation instant, which is what makes newest-first listing
        // a key condition rather than a sort of the whole partition.
        invDate:      now,
        createdAt:    now,
    };
};

const numberOf = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

const snapshots = (
    products: Readonly<Record<string, CatalogueProduct>>,
): Record<string, ProductSnapshot> => {
    const out: Record<string, ProductSnapshot> = {};
    for (const [id, product] of Object.entries(products)) {
        out[id] = { id, name: product.name, earliestExpiry: product.earliestExpiry };
    }
    return out;
};

// ── Invoice numbering ──────────────────────────────────────────────────────

export const formatInvoiceNo = (type: InvoiceType, year: number, seq: number): string =>
    `${type === 'SALE' ? 'INV' : 'PUR'}-${year}-${String(seq).padStart(4, '0')}`;

/**
 * Reserve the next number for this user and type, atomically.
 *
 * The counter item is `{ seq, year }`. Two shapes of update, because DynamoDB
 * cannot pick between `ADD` and `SET` inside one expression:
 *
 *  - SAME year (or a brand-new counter) → `ADD seq :1`.
 *  - NEW year → `SET seq = 1, year = <year>`, guarded by `year <> :year` so
 *    exactly one concurrent caller performs the reset and the rest fall back
 *    to the ADD against the freshly-reset item.
 *
 * `ADD` on a missing item creates it at 0 first, so the very first invoice of
 * a new user is 1 with no seeding step.
 *
 * `seq` and `year` are both aliased. `YEAR` is on DynamoDB's reserved-word
 * list outright; `seq` is not, but it is exactly the kind of short generic
 * noun AWS keeps adding, and an alias costs nothing.
 */
export const reserveInvoiceNo = async (
    uid: string,
    type: CounterType,
    year: number,
    send: Send,
): Promise<{ seq: number; year: number }> => {
    const NAMES  = { '#seq': 'seq', '#year': 'year' };
    const key    = keys.counter(uid, type);

    // Bounded: each iteration either returns or loses a race that can only be
    // lost once per competing writer, and a reset makes the ADD path succeed.
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await send(new UpdateCommand({
                TableName: TABLE,
                Key: key,
                UpdateExpression:          'ADD #seq :one SET #year = :year',
                ConditionExpression:       'attribute_not_exists(#year) OR #year = :year',
                ExpressionAttributeNames:  NAMES,
                ExpressionAttributeValues: { ':one': 1, ':year': year },
                ReturnValues:              'UPDATED_NEW',
            }));
            return { seq: seqOf(res), year };
        } catch (err) {
            if (!isConditionalFailure(err)) throw err;
        }

        try {
            const res = await send(new UpdateCommand({
                TableName: TABLE,
                Key: key,
                UpdateExpression:          'SET #seq = :one, #year = :year',
                ConditionExpression:       '#year <> :year',
                ExpressionAttributeNames:  NAMES,
                ExpressionAttributeValues: { ':one': 1, ':year': year },
                ReturnValues:              'UPDATED_NEW',
            }));
            return { seq: seqOf(res), year };
        } catch (err) {
            if (!isConditionalFailure(err)) throw err;
            // Someone else reset first — go round and take a number from theirs.
        }
    }

    throw new Error(`invoice counter for ${type} contended beyond 3 attempts`);
};

const seqOf = (res: Record<string, unknown>): number => {
    const attributes = res.Attributes as { seq?: unknown } | undefined;
    const seq = Number(attributes?.seq ?? 1);
    return Number.isFinite(seq) && seq > 0 ? seq : 1;
};

// ── Loads ──────────────────────────────────────────────────────────────────

/**
 * Read the catalogue rows a request references.
 *
 * `BatchGet` caps at 100 keys and the line cap is 30, so one call always
 * suffices. `UnprocessedKeys` is still retried — a throttled partial response
 * would otherwise read as "product not found" and 400 a perfectly valid
 * invoice.
 */
export const loadProducts = async (
    uid: string,
    productIds: readonly string[],
    send: Send,
): Promise<Record<string, CatalogueProduct>> => {
    const found: Record<string, CatalogueProduct> = {};
    if (productIds.length === 0) return found;

    let pending = productIds.map(id => keys.product(uid, id));

    for (let attempt = 0; attempt < 4 && pending.length; attempt++) {
        const res = await send(new BatchGetCommand({
            RequestItems: { [TABLE]: { Keys: pending } },
        }));

        const responses = (res.Responses as Record<string, Record<string, unknown>[]> | undefined);
        for (const item of responses?.[TABLE] ?? []) {
            found[String(item.id)] = item as unknown as CatalogueProduct;
        }

        const unprocessed = (res.UnprocessedKeys as
            Record<string, { Keys?: Record<string, unknown>[] }> | undefined);
        pending = (unprocessed?.[TABLE]?.Keys ?? []) as typeof pending;
    }

    return found;
};

// ── Failure mapping ────────────────────────────────────────────────────────

const isConditionalFailure = (err: unknown): boolean =>
    (err as { name?: string })?.name === 'ConditionalCheckFailedException';

interface CancelledError {
    name?: string;
    CancellationReasons?: { Code?: string }[];
}

/**
 * Turn a cancelled transaction into the right 409.
 *
 * `CancellationReasons` is POSITIONAL — reason[i] belongs to TransactItems[i].
 * The invoice `Put` is item 0 by construction, so index 0 is the idempotency
 * guard and any other index is a batch's oversell guard. Reading the array
 * rather than guessing is what keeps DUPLICATE and INSUFFICIENT_STOCK from
 * being reported as each other.
 */
const mapTransactionFailure = async (
    err: unknown,
    uid: string,
    stockItems: readonly unknown[],
    invoice: Invoice,
    send: Send,
    onGuardFail: () => APIGatewayProxyResult,
    /**
     * What a failed BATCH guard means here. Forward it is INSUFFICIENT_STOCK —
     * the sale wants more than the lot holds. In reverse it is
     * STOCK_ALREADY_SOLD — the purchased units have since left, so the
     * cancellation cannot take them back and the fix is a batch correction,
     * not a retry. Same condition, opposite stories.
     */
    stockFailCode: 'INSUFFICIENT_STOCK' | 'STOCK_ALREADY_SOLD' = 'INSUFFICIENT_STOCK',
): Promise<APIGatewayProxyResult | null> => {
    const e = err as CancelledError;
    if (e?.name !== 'TransactionCanceledException') return null;

    const reasons = e.CancellationReasons ?? [];
    const failed  = reasons.findIndex(r => r?.Code === 'ConditionalCheckFailed');
    if (failed < 0) return null;

    // Index 0 is the invoice Put's own guard — DUPLICATE on create, NOT_DRAFT on
    // finalize, NOT_FINALIZED on cancel. The caller names it.
    if (failed === 0) return onGuardFail();

    // Every other guarded item is a batch decrement.
    const item = stockItems[failed - 1] as { Update?: { Key?: { SK?: unknown } } } | undefined;
    const sk   = String(item?.Update?.Key?.SK ?? '');
    const match = /^BATCH#(.+)#(\d{4}-\d{2}-\d{2})$/.exec(sk);

    if (!match) {
        // A guarded item that is not a batch key means the plan's shape changed
        // without this mapper. Say so plainly rather than mislabel it.
        return conflict(stockFailCode,
            'The stock changed while this invoice was being saved — reload and try again',
            { id: invoice.id });
    }

    const [, productId, expiryDate] = match;
    const line = invoice.lines.find(l => l.productId === productId && l.expiryDate === expiryDate);

    // Best-effort: report what IS on hand. Nothing was written, so this read is
    // safe, and if it fails the 409 still goes out — just without the number.
    let available: number | undefined;
    try {
        const res = await send(new GetCommand({
            TableName: TABLE, Key: keys.batch(uid, productId, expiryDate),
        }));
        const batch = res.Item as { quantity?: unknown } | undefined;
        if (batch) available = Number(batch.quantity ?? 0);
    } catch { /* leave `available` undefined */ }

    const message = stockFailCode === 'STOCK_ALREADY_SOLD'
        ? `Some of this ${line?.name ?? productId} has already been sold, so the purchase cannot be cancelled — correct the batch instead`
        : available === undefined
            ? `Not enough stock in the selected batch for ${line?.name ?? productId}`
            : `Not enough stock in the selected batch (${available} available)`;

    return conflict(stockFailCode, message,
        { productId, expiryDate, ...(available === undefined ? {} : { available }) });
};

// ── Helpers ────────────────────────────────────────────────────────────────

const parseBody = (event: APIGatewayProxyEvent): unknown => {
    if (!event.body) return null;
    try {
        return JSON.parse(event.body);
    } catch {
        return null;
    }
};

const stripKeys = (item: Record<string, unknown>): Record<string, unknown> => {
    const { PK, SK, ...rest } = item;
    void PK; void SK;
    return rest;
};

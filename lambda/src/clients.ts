import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    PutCommand, GetCommand, DeleteCommand, QueryCommand, UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys } from './lib/db';
import { ok, created, noContent, badRequest, notFound, serverError, forbidden, getUid, resolveCors } from './lib/response';
import { guardAccount } from './lib/accountGuard';
import { stripTableKeys } from './lib/sanitize';
import { batchWriteAll, BULK_DEADLINE_MS, type WriteReq } from './lib/batch';

// ── Types ──────────────────────────────────────────────────────────────────

interface Client {
    id: string;
    clientName: string;
    clientNameLower: string;
    mobileDigits: string;
    mobile: string;
    countryCode: string;
    email: string;
    clientType: string;
    status: string;
    frequency: string;
    nextFollowUpDate: string;
    notes: string;
    createdAt: string;
    [key: string]: unknown;
}

// ── Handler ────────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        resolveCors(event);
        const uid    = getUid(event);
        const { blocked, profile } = await guardAccount(uid);
        if (blocked) return blocked;

        const method = event.httpMethod;
        const id     = event.pathParameters?.id;
        const path   = event.resource ?? event.path;

        // Bulk operations
        if (path.endsWith('/bulk')) {
            if (method === 'POST')   return await bulkAdd(uid, event);
            if (method === 'DELETE') return await bulkDelete(uid, event);
        }

        if (method === 'GET'    && !id) return await listClients(uid, event);
        if (method === 'POST'   && !id) return await addClient(uid, event, profile);
        if (method === 'GET'    &&  id) return await getClient(uid, id);
        if (method === 'PUT'    &&  id) return await updateClient(uid, id, event);
        if (method === 'DELETE' &&  id) return await deleteClient(uid, id);

        return badRequest('Unknown route');
    } catch (err) {
        return serverError(err);
    }
};

// ── List clients (with filter + pagination) ────────────────────────────────

const listClients = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const q = event.queryStringParameters ?? {};

    // NEW (audit B1): due / calendar range mode — GSI1 scoped to a nextFollowUpDate range.
    // Built independently (own KeyCondition/Filter/values) so the default list path below
    // is untouched and non-range calls behave exactly as before.
    if (q.dueBefore || q.dueFrom) {
        return await listClientsByDateRange(uid, q);
    }

    const filterType  = q.clientType;
    const searchQuery = q.search?.toLowerCase();
    const sortBy      = q.sortBy ?? 'nextFollowUpDate';
    const pageSize    = Math.min(parseInt(q.limit ?? '50'), 200);
    const lastKey     = q.nextToken ? JSON.parse(Buffer.from(q.nextToken, 'base64').toString()) : undefined;

    // Choose GSI based on query
    let indexName: string | undefined;
    let keyCondition = 'PK = :pk AND begins_with(SK, :prefix)';
    const exprValues: Record<string, unknown> = {
        ':pk':     `USER#${uid}`,
        ':prefix': 'CLIENT#',
    };

    if (searchQuery) {
        indexName    = 'GSI3-ClientName';
        keyCondition = 'PK = :pk AND begins_with(clientNameLower, :search)';
        exprValues[':search'] = searchQuery;
        delete exprValues[':prefix'];
    } else if (sortBy === 'nextFollowUpDate') {
        indexName = 'GSI1-FollowUpDate';
        keyCondition = 'PK = :pk';
    }

    const filterParts: string[] = [];
    let filterExpr: string | undefined;

    if (filterType && filterType !== 'All') {
        filterParts.push('clientType = :clientType');
        exprValues[':clientType'] = filterType;
    }
    if (!searchQuery) {
        filterParts.push('begins_with(SK, :prefix)');
    }
    if (filterParts.length) filterExpr = filterParts.join(' AND ');

    const result = await db.send(new QueryCommand({
        TableName:                 TABLE,
        IndexName:                 indexName,
        KeyConditionExpression:    keyCondition,
        FilterExpression:          filterExpr,
        ExpressionAttributeValues: exprValues,
        Limit:                     pageSize,
        ExclusiveStartKey:         lastKey,
        ScanIndexForward:          sortBy !== 'nextFollowUpDate' ? true : true,
    }));

    const clients = (result.Items ?? []).map(stripKeys);
    const nextToken = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null;

    return ok({ clients, nextToken, count: result.Count ?? 0 });
};

// ── List clients by follow-up date range (due list + calendar) ──────────────
// Self-contained: constructs its own KeyCondition / Filter / values from scratch —
// shares NO expression seed with listClients above. GSI1's sort key is
// nextFollowUpDate, so the range is applied in the KeyCondition and only due/in-range
// clients are read (not the whole DB). Caller paginates nextToken for completeness.
const listClientsByDateRange = async (
    uid: string,
    q: Record<string, string | undefined>,
): Promise<APIGatewayProxyResult> => {
    const dueFrom   = q.dueFrom;
    const dueBefore = q.dueBefore;
    const pageSize  = Math.min(parseInt(q.limit ?? '200', 10), 500);
    const lastKey   = q.nextToken ? JSON.parse(Buffer.from(q.nextToken, 'base64').toString()) : undefined;

    const values: Record<string, unknown> = { ':pk': `USER#${uid}`, ':prefix': 'CLIENT#' };
    const names:  Record<string, string>  = {};

    let keyCondition: string;
    if (dueFrom && dueBefore) {
        keyCondition = 'PK = :pk AND nextFollowUpDate BETWEEN :dueFrom AND :dueBefore';
        values[':dueFrom'] = dueFrom; values[':dueBefore'] = dueBefore;
    } else if (dueBefore) {
        keyCondition = 'PK = :pk AND nextFollowUpDate <= :dueBefore';
        values[':dueBefore'] = dueBefore;
    } else {
        keyCondition = 'PK = :pk AND nextFollowUpDate >= :dueFrom';
        values[':dueFrom'] = dueFrom;
    }

    const filterParts = ['begins_with(SK, :prefix)'];
    if (q.status) {
        filterParts.push('#status = :status');
        values[':status'] = q.status; names['#status'] = 'status';
    }
    if (q.clientType && q.clientType !== 'All') {
        filterParts.push('clientType = :clientType');
        values[':clientType'] = q.clientType;
    }
    if (q.search) {
        filterParts.push('begins_with(clientNameLower, :search)');
        values[':search'] = q.search.toLowerCase();
    }

    const result = await db.send(new QueryCommand({
        TableName:                 TABLE,
        IndexName:                 'GSI1-FollowUpDate',
        KeyConditionExpression:    keyCondition,
        FilterExpression:          filterParts.join(' AND '),
        ExpressionAttributeValues: values,
        ExpressionAttributeNames:  Object.keys(names).length ? names : undefined,
        Limit:                     pageSize,
        ExclusiveStartKey:         lastKey,
        ScanIndexForward:          true,
    }));

    const clients = (result.Items ?? []).map(stripKeys);
    const nextToken = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null;
    return ok({ clients, nextToken, count: result.Count ?? 0 });
};

// ── Get single client ──────────────────────────────────────────────────────

const getClient = async (uid: string, id: string): Promise<APIGatewayProxyResult> => {
    const result = await db.send(new GetCommand({ TableName: TABLE, Key: keys.client(uid, id) }));
    if (!result.Item) return notFound('Client not found');
    return ok(stripKeys(result.Item));
};

// ── Add client ─────────────────────────────────────────────────────────────

const addClient = async (
    uid: string,
    event: APIGatewayProxyEvent,
    profile: Record<string, unknown> | null,
): Promise<APIGatewayProxyResult> => {
    const body = stripTableKeys(parseBody<Client>(event));
    if (typeof body.clientName !== 'string' || typeof body.mobile !== 'string'
        || !body.clientName.trim() || !body.mobile.trim()) {
        return badRequest('clientName and mobile are required strings');
    }

    // Per-account cap (audit B1). Fast path uses the cached counter from the profile
    // (already fetched by guardAccount — no extra read). The counter can over-count via
    // drift, which would falsely lock out a user who is actually below the cap — so when
    // it *says* we're full, confirm with an authoritative COUNT before blocking, and heal
    // the counter if it had drifted. This pays the COUNT only at the cliff edge.
    if (Number(profile?.clientCount ?? 0) >= CLIENT_CAP) {
        const actual = await countClients(uid);
        if (actual >= CLIENT_CAP) {
            return forbidden('CLIENT_LIMIT_REACHED',
                `You've reached the ${CLIENT_CAP.toLocaleString()} client limit. Delete some clients to add more.`,
                { current: actual, limit: CLIENT_CAP });
        }
        await setClientCount(uid, actual); // drift was high — heal so the user isn't stuck
    }

    const item = {
        ...body,
        ...keys.client(uid, body.id),  // keys MUST win — prevents PK/SK override
        clientNameLower: body.clientName.toLowerCase().trim(),
        mobileDigits:    body.mobile.replace(/\D/g, ''),
        createdAt:       body.createdAt ?? new Date().toISOString(),
    };

    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    await adjustClientCount(uid, 1); // best-effort; authoritative recount on bulk / at cap
    return created(stripKeys(item));
};

// ── Update client ──────────────────────────────────────────────────────────

const updateClient = async (uid: string, id: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = stripTableKeys(parseBody<Client>(event));
    const item = {
        ...body,
        ...keys.client(uid, id),  // keys MUST win — prevents PK/SK override
        id,
        clientNameLower: typeof body.clientName === 'string' ? body.clientName.toLowerCase().trim() : undefined,
        mobileDigits:    typeof body.mobile === 'string' ? body.mobile.replace(/\D/g, '') : undefined,
    };

    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return ok(stripKeys(item));
};

// ── Delete client ──────────────────────────────────────────────────────────

const deleteClient = async (uid: string, id: string): Promise<APIGatewayProxyResult> => {
    await db.send(new DeleteCommand({ TableName: TABLE, Key: keys.client(uid, id) }));
    await adjustClientCount(uid, -1); // best-effort; reconciled authoritatively on bulk / at cap
    return noContent();
};

// ── Bulk add ───────────────────────────────────────────────────────────────

const MAX_BULK_CLIENTS = 5000;

const bulkAdd = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { clients } = parseBody<{ clients: Client[] }>(event);
    if (!Array.isArray(clients) || clients.length === 0) return badRequest('clients array required');
    if (clients.length > MAX_BULK_CLIENTS) {
        return badRequest(`bulk import limited to ${MAX_BULK_CLIENTS} clients per request`);
    }

    // Per-account cap (audit B1) — a SINGLE upstream gate, before any write/retry, so retries
    // can never bypass it. Authoritative COUNT (not the drift-prone cached counter).
    const existing = await countClients(uid);
    if (existing + clients.length > CLIENT_CAP) {
        return forbidden('CLIENT_LIMIT_REACHED',
            `This import would exceed the ${CLIENT_CAP.toLocaleString()} client limit.`,
            { current: existing, limit: CLIENT_CAP, remaining: Math.max(0, CLIENT_CAP - existing) });
    }

    // Build + validate ALL requests up front, so a bad row is rejected before any write.
    const requests: WriteReq[] = [];
    for (let idx = 0; idx < clients.length; idx++) {
        const safe = stripTableKeys(clients[idx]);
        if (typeof safe.clientName !== 'string' || typeof safe.mobile !== 'string'
            || !safe.clientName.trim() || !safe.mobile.trim()) {
            return badRequest(`clients[${idx}]: clientName and mobile are required strings`);
        }
        requests.push({ PutRequest: { Item: {
            ...safe,
            ...keys.client(uid, safe.id),  // keys MUST win
            clientNameLower: safe.clientName.toLowerCase().trim(),
            mobileDigits:    safe.mobile.replace(/\D/g, ''),
        } } });
    }

    // Write with UnprocessedItems retry + wall-clock budget (audit B2). Reports what ACTUALLY
    // persisted — no silent drop.
    const { persisted, timedOut } = await batchWriteAll(requests, Date.now() + BULK_DEADLINE_MS);

    // Reconcile the counter to what actually landed (keeps the cap accurate on partial import).
    await setClientCount(uid, existing + persisted);
    return ok({ imported: persisted, requested: clients.length, failed: clients.length - persisted, timedOut });
};

// ── Bulk delete ────────────────────────────────────────────────────────────

const bulkDelete = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { ids } = parseBody<{ ids: string[] }>(event);
    if (!Array.isArray(ids) || ids.length === 0) return badRequest('ids array required');

    // Write with UnprocessedItems retry + wall-clock budget (audit B2) — no silent drop.
    const requests: WriteReq[] = ids.map(id => ({ DeleteRequest: { Key: keys.client(uid, id) } }));
    const { persisted, timedOut } = await batchWriteAll(requests, Date.now() + BULK_DEADLINE_MS);

    await adjustClientCount(uid, -persisted); // best-effort; reconciled on next bulk add
    return ok({ deleted: persisted, requested: ids.length, timedOut });
};

// ── Per-account client cap (audit B1) ───────────────────────────────────────

const CLIENT_CAP = 25000;

// Authoritative count of a user's client rows. COUNT is per-page in DynamoDB, so
// aggregate across pages. Used only at the cap cliff / on bulk import (never per add).
const countClients = async (uid: string): Promise<number> => {
    let count = 0;
    let lastKey: Record<string, unknown> | undefined;
    do {
        const r = await db.send(new QueryCommand({
            TableName:                 TABLE,
            KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': `USER#${uid}`, ':prefix': 'CLIENT#' },
            Select:                    'COUNT',
            ExclusiveStartKey:         lastKey,
        }));
        count += r.Count ?? 0;
        lastKey = r.LastEvaluatedKey;
    } while (lastKey);
    return count;
};

// Best-effort counter maintenance. Drift is tolerable (this is a cost cap, not a
// security boundary): the bulk path recounts authoritatively and addClient confirms at
// the cliff, so drift can neither be exploited nor permanently strand a user.
const adjustClientCount = async (uid: string, delta: number): Promise<void> => {
    try {
        await db.send(new UpdateCommand({
            TableName:                 TABLE,
            Key:                       keys.profile(uid),
            UpdateExpression:          'ADD clientCount :d',
            ExpressionAttributeValues: { ':d': delta },
        }));
    } catch { /* best-effort — counter self-heals on the next bulk / cap confirm */ }
};

const setClientCount = async (uid: string, n: number): Promise<void> => {
    try {
        await db.send(new UpdateCommand({
            TableName:                 TABLE,
            Key:                       keys.profile(uid),
            UpdateExpression:          'SET clientCount = :n',
            ExpressionAttributeValues: { ':n': n },
        }));
    } catch { /* best-effort */ }
};

// ── Helpers ────────────────────────────────────────────────────────────────

const parseBody = <T>(event: APIGatewayProxyEvent): T => {
    if (!event.body) throw new Error('Missing request body');
    return JSON.parse(event.body) as T;
};

// Remove DynamoDB table keys (PK/SK) from response
const stripKeys = (item: Record<string, unknown>): Record<string, unknown> => {
    const { PK, SK, ...rest } = item;
    void PK; void SK;
    return rest;
};

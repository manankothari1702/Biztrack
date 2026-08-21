import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE } from './lib/db';
import { ok, badRequest, serverError, methodNotAllowed, unauthorized, tryGetUid, resolveCors } from './lib/response';
import { guardAccount } from './lib/accountGuard';

/**
 * Stock movements — the audit log.
 *
 * READ ONLY, by design. Movements are written exclusively by lib/stock.ts,
 * inside the same transaction that moves the batch and the product roll-up.
 * That coupling is the whole point: a movement row can never exist without the
 * stock change it records, and vice versa. An endpoint that let a client post
 * one would break that guarantee silently — so there is no POST, PUT or DELETE
 * here, and any such request gets a 405.
 */

const MOVEMENT_PREFIX = 'STOCKMOVE#';

const MOVEMENT_TYPES = ['IN', 'OUT', 'ADJUST', 'WRITE_OFF'] as const;

// ── Handler ────────────────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        resolveCors(event);
        const uid = tryGetUid(event);
        if (!uid) return unauthorized();

        const { blocked } = await guardAccount(uid);
        if (blocked) return blocked;

        if (event.httpMethod === 'GET') return await listMovements(uid, event);

        // NOT dead code. Unreachable via API Gateway today (only GET/OPTIONS are
        // routed, so an unrouted verb 403s before this Lambda runs), but it still
        // answers direct invocations and is what would refuse a write if POST is
        // ever added to the resource. See 05_API_CONTRACT.md §4.
        return methodNotAllowed(['GET'],
            'Stock movements are written by the system when stock changes; they cannot be created, edited or deleted directly');
    } catch (err) {
        return serverError(err);
    }
};

// ── List movements ─────────────────────────────────────────────────────────
//
// Sole query in this file, so it builds its own values map from scratch and
// shares no expression seed with anything (the convention that tasks.ts and
// clients.ts follow for their range queries).
//
// `createdAt` leads the sort-key suffix — SK is `STOCKMOVE#<createdAt>#<id>` —
// so a date range is answered by a KeyCondition on SK, reading only the rows in
// the window rather than filtering the partition. ScanIndexForward:false then
// walks it newest-first for free.
const listMovements = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const q = event.queryStringParameters ?? {};

    const pageSize = Math.min(parseInt(q.limit ?? '50'), 200);
    const lastKey  = q.nextToken ? JSON.parse(Buffer.from(q.nextToken, 'base64').toString()) : undefined;

    if (q.type && !MOVEMENT_TYPES.includes(q.type as typeof MOVEMENT_TYPES[number])) {
        return badRequest('VALIDATION',
            `type must be one of: ${MOVEMENT_TYPES.join(', ')}`, { allowed: MOVEMENT_TYPES });
    }

    const values: Record<string, unknown> = { ':pk': `USER#${uid}` };
    const names:  Record<string, string>  = {};

    const bounds = movementSkBounds(q.from, q.to);
    let keyCondition: string;
    if (bounds) {
        keyCondition = 'PK = :pk AND SK BETWEEN :lower AND :upper';
        values[':lower'] = bounds.lower;
        values[':upper'] = bounds.upper;
    } else {
        keyCondition = 'PK = :pk AND begins_with(SK, :prefix)';
        values[':prefix'] = MOVEMENT_PREFIX;
    }

    const filterParts: string[] = [];
    if (q.productId) {
        filterParts.push('productId = :productId');
        values[':productId'] = q.productId;
    }
    if (q.type) {
        // `type` is a DynamoDB reserved word — it must be aliased.
        filterParts.push('#type = :type');
        names['#type']   = 'type';
        values[':type']  = q.type;
    }

    const result = await db.send(new QueryCommand({
        TableName:                 TABLE,
        KeyConditionExpression:    keyCondition,
        FilterExpression:          filterParts.length ? filterParts.join(' AND ') : undefined,
        ExpressionAttributeValues: values,
        ExpressionAttributeNames:  Object.keys(names).length ? names : undefined,
        Limit:                     pageSize,
        ExclusiveStartKey:         lastKey,
        ScanIndexForward:          false,   // newest first
    }));

    const movements = (result.Items ?? []).map(stripKeys);
    const nextToken = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null;

    return ok({ movements, nextToken });
};

/**
 * Sort-key bounds for a `from`/`to` window, or null when unbounded.
 *
 * Both ends accept a date (`2026-07-22`) or a full timestamp
 * (`2026-07-22T10:00:00.000Z`) — prefix comparison handles either, so a bare
 * date naturally covers that whole day.
 *
 * The upper bound MUST be present even when only `from` is given: a plain
 * `SK >= 'STOCKMOVE#…'` would spill into `TASK#` rows, which sort after
 * `STOCKMOVE#`. The `￿` sentinel sorts above any character that can appear
 * in a timestamp, making the bound inclusive of the whole prefix.
 */
export const movementSkBounds = (
    from?: string,
    to?: string,
): { lower: string; upper: string } | null => {
    if (!from && !to) return null;
    return {
        lower: from ? `${MOVEMENT_PREFIX}${from}` : MOVEMENT_PREFIX,
        upper: to   ? `${MOVEMENT_PREFIX}${to}￿` : `${MOVEMENT_PREFIX}￿`,
    };
};

// ── Helpers ────────────────────────────────────────────────────────────────

// Remove DynamoDB table keys (PK/SK) from response
const stripKeys = (item: Record<string, unknown>): Record<string, unknown> => {
    const { PK, SK, ...rest } = item;
    void PK; void SK;
    return rest;
};

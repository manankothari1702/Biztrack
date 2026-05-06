import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
    PutCommand, GetCommand, DeleteCommand, QueryCommand, BatchWriteCommand
} from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys } from './lib/db';
import { ok, created, noContent, badRequest, notFound, serverError, getUid } from './lib/response';

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
        const uid    = getUid(event);
        const method = event.httpMethod;
        const id     = event.pathParameters?.id;
        const path   = event.resource ?? event.path;

        // Bulk operations
        if (path.endsWith('/bulk')) {
            if (method === 'POST')   return await bulkAdd(uid, event);
            if (method === 'DELETE') return await bulkDelete(uid, event);
        }

        if (method === 'GET'    && !id) return await listClients(uid, event);
        if (method === 'POST'   && !id) return await addClient(uid, event);
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

// ── Get single client ──────────────────────────────────────────────────────

const getClient = async (uid: string, id: string): Promise<APIGatewayProxyResult> => {
    const result = await db.send(new GetCommand({ TableName: TABLE, Key: keys.client(uid, id) }));
    if (!result.Item) return notFound('Client not found');
    return ok(stripKeys(result.Item));
};

// ── Add client ─────────────────────────────────────────────────────────────

const addClient = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = parseBody<Client>(event);
    if (!body.clientName || !body.mobile) return badRequest('clientName and mobile are required');

    const item = {
        ...keys.client(uid, body.id),
        ...body,
        clientNameLower: body.clientName.toLowerCase().trim(),
        mobileDigits:    body.mobile.replace(/\D/g, ''),
        createdAt:       body.createdAt ?? new Date().toISOString(),
    };

    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return created(stripKeys(item));
};

// ── Update client ──────────────────────────────────────────────────────────

const updateClient = async (uid: string, id: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = parseBody<Client>(event);
    const item = {
        ...keys.client(uid, id),
        ...body,
        id,
        clientNameLower: body.clientName ? body.clientName.toLowerCase().trim() : undefined,
        mobileDigits:    body.mobile ? body.mobile.replace(/\D/g, '') : undefined,
    };

    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return ok(stripKeys(item));
};

// ── Delete client ──────────────────────────────────────────────────────────

const deleteClient = async (uid: string, id: string): Promise<APIGatewayProxyResult> => {
    await db.send(new DeleteCommand({ TableName: TABLE, Key: keys.client(uid, id) }));
    return noContent();
};

// ── Bulk add ───────────────────────────────────────────────────────────────

const bulkAdd = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { clients } = parseBody<{ clients: Client[] }>(event);
    if (!Array.isArray(clients) || clients.length === 0) return badRequest('clients array required');

    // DynamoDB batch limit is 25
    const CHUNK = 25;
    for (let i = 0; i < clients.length; i += CHUNK) {
        const chunk = clients.slice(i, i + CHUNK);
        await db.send(new BatchWriteCommand({
            RequestItems: {
                [TABLE]: chunk.map(c => ({
                    PutRequest: {
                        Item: {
                            ...keys.client(uid, c.id),
                            ...c,
                            clientNameLower: c.clientName.toLowerCase().trim(),
                            mobileDigits:    c.mobile.replace(/\D/g, ''),
                        },
                    },
                })),
            },
        }));
    }

    return ok({ imported: clients.length });
};

// ── Bulk delete ────────────────────────────────────────────────────────────

const bulkDelete = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const { ids } = parseBody<{ ids: string[] }>(event);
    if (!Array.isArray(ids) || ids.length === 0) return badRequest('ids array required');

    const CHUNK = 25;
    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        await db.send(new BatchWriteCommand({
            RequestItems: {
                [TABLE]: chunk.map(id => ({
                    DeleteRequest: { Key: keys.client(uid, id) },
                })),
            },
        }));
    }

    return ok({ deleted: ids.length });
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

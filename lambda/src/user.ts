import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys } from './lib/db';
import { ok, noContent, badRequest, notFound, serverError, getUid } from './lib/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const uid    = getUid(event);
        const method = event.httpMethod;
        const path   = event.resource ?? event.path;
        const nodeId = event.pathParameters?.nodeId;

        // /user/org/{nodeId}
        if (path.includes('/org/') && nodeId) {
            if (method === 'PUT')    return await updateOrgNode(uid, nodeId, event);
            if (method === 'DELETE') return await deleteOrgNode(uid, nodeId);
        }

        // /user/org
        if (path.endsWith('/org')) {
            if (method === 'GET')  return await listOrgNodes(uid);
            if (method === 'POST') return await addOrgNode(uid, event);
        }

        // /user
        if (method === 'GET') return await getProfile(uid);
        if (method === 'PUT') return await updateProfile(uid, event);

        return badRequest('Unknown route');
    } catch (err) {
        return serverError(err);
    }
};

// ── Profile ────────────────────────────────────────────────────────────────

const getProfile = async (uid: string): Promise<APIGatewayProxyResult> => {
    const result = await db.send(new GetCommand({ TableName: TABLE, Key: keys.profile(uid) }));
    if (!result.Item) return notFound('Profile not found');
    return ok(stripKeys(result.Item));
};

const updateProfile = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (!event.body) return badRequest('Missing body');
    const body = JSON.parse(event.body);
    const item = { ...keys.profile(uid), ...body };
    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return ok(stripKeys(item));
};

// ── Org Nodes ──────────────────────────────────────────────────────────────

const listOrgNodes = async (uid: string): Promise<APIGatewayProxyResult> => {
    const result = await db.send(new QueryCommand({
        TableName:              TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${uid}`, ':prefix': 'ORG#' },
    }));
    return ok({ orgNodes: (result.Items ?? []).map(stripKeys) });
};

const addOrgNode = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (!event.body) return badRequest('Missing body');
    const node = JSON.parse(event.body);
    if (!node.id) return badRequest('id is required');
    const item = { ...keys.orgNode(uid, node.id), ...node };
    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return ok(stripKeys(item));
};

const updateOrgNode = async (uid: string, nodeId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (!event.body) return badRequest('Missing body');
    const node = JSON.parse(event.body);
    const item = { ...keys.orgNode(uid, nodeId), ...node, id: nodeId };
    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return ok(stripKeys(item));
};

const deleteOrgNode = async (uid: string, nodeId: string): Promise<APIGatewayProxyResult> => {
    await db.send(new DeleteCommand({ TableName: TABLE, Key: keys.orgNode(uid, nodeId) }));
    return noContent();
};

// ── Helpers ────────────────────────────────────────────────────────────────

const stripKeys = (item: Record<string, unknown>): Record<string, unknown> => {
    const { PK, SK, ...rest } = item;
    void PK; void SK;
    return rest;
};

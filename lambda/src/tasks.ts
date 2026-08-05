import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys } from './lib/db';
import { ok, created, noContent, badRequest, notFound, serverError, getUid, resolveCors } from './lib/response';
import { guardAccount } from './lib/accountGuard';
import { stripTableKeys } from './lib/sanitize';

interface Task {
    id: string;
    title: string;
    priority: 'High' | 'Medium' | 'Low';
    status: 'Pending' | 'In Progress' | 'Completed';
    dueDate: string;
    notes: string;
    [key: string]: unknown;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        resolveCors(event);
        const uid    = getUid(event);
        const { blocked } = await guardAccount(uid);
        if (blocked) return blocked;

        const method = event.httpMethod;
        const id     = event.pathParameters?.id;

        if (method === 'GET'    && !id) return await listTasks(uid, event);
        if (method === 'POST'   && !id) return await addTask(uid, event);
        if (method === 'GET'    &&  id) return await getTask(uid, id);
        if (method === 'PUT'    &&  id) return await updateTask(uid, id, event);
        if (method === 'DELETE' &&  id) return await deleteTask(uid, id);

        return badRequest('Unknown route');
    } catch (err) {
        return serverError(err);
    }
};

const listTasks = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const q        = event.queryStringParameters ?? {};

    // NEW (audit B1): calendar date-range mode — GSI2 scoped to a dueDate range. Built by
    // a fully independent function (own KeyCondition / Filter / values, from scratch); it
    // shares NO expression seed with the status/priority branch below. That branch carried
    // an orphaned :prefix binding until it was fixed to seed filterParts the same way.
    if (q.from || q.to) {
        return await listTasksByDateRange(uid, q);
    }

    const status   = q.status;   // 'Pending' | 'In Progress' | 'Completed' | 'Overdue' | undefined
    const priority = q.priority; // 'High' | 'Medium' | 'Low' | undefined
    const pageSize = Math.min(parseInt(q.limit ?? '50'), 200);
    const lastKey  = q.nextToken ? JSON.parse(Buffer.from(q.nextToken, 'base64').toString()) : undefined;

    const exprValues: Record<string, unknown> = {
        ':pk':     `USER#${uid}`,
        ':prefix': 'TASK#',
    };

    const filterParts: string[] = ['begins_with(SK, :prefix)'];

    if (status === 'Overdue') {
        filterParts.push('#status <> :completed');
        filterParts.push('dueDate < :now');
        exprValues[':completed'] = 'Completed';
        exprValues[':now']       = new Date().toISOString();
    } else if (status) {
        filterParts.push('#status = :status');
        exprValues[':status'] = status;
    }

    if (priority) {
        filterParts.push('priority = :priority');
        exprValues[':priority'] = priority;
    }

    const result = await db.send(new QueryCommand({
        TableName:                 TABLE,
        IndexName:                 'GSI2-TaskStatus',
        KeyConditionExpression:    'PK = :pk',
        FilterExpression:          filterParts.join(' AND '),
        ExpressionAttributeValues: exprValues,
        ExpressionAttributeNames:  status ? { '#status': 'status' } : undefined,
        Limit:                     pageSize,
        ExclusiveStartKey:         lastKey,
        ScanIndexForward:          true, // sort by dueDate asc
    }));

    // For Overdue+High, sort client-side (can't multi-sort in DynamoDB)
    let tasks = (result.Items ?? []).map(stripKeys) as Task[];
    if (status === 'Overdue' && priority === 'High') {
        const order = { High: 0, Medium: 1, Low: 2 } as const;
        tasks = tasks.sort((a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3));
    }

    const nextToken = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null;

    return ok({ tasks, nextToken });
};

// ── List tasks by due-date range (calendar) ─────────────────────────────────
// Self-contained: own KeyCondition / Filter / values, no shared seed with listTasks.
// GSI2's sort key is dueDate, so the range is applied in the KeyCondition (only in-range
// tasks are read). Caller paginates nextToken for completeness (fixes the old <=200-page
// silent drop). Tasks with no dueDate are absent from GSI2 — correctly not on a calendar.
const listTasksByDateRange = async (
    uid: string,
    q: Record<string, string | undefined>,
): Promise<APIGatewayProxyResult> => {
    const from = q.from;
    const to   = q.to;
    const excludeCompleted = q.excludeCompleted === '1' || q.excludeCompleted === 'true';
    const pageSize = Math.min(parseInt(q.limit ?? '200', 10), 500);
    const lastKey  = q.nextToken ? JSON.parse(Buffer.from(q.nextToken, 'base64').toString()) : undefined;

    const values: Record<string, unknown> = { ':pk': `USER#${uid}`, ':prefix': 'TASK#' };
    const names:  Record<string, string>  = {};

    let keyCondition: string;
    if (from && to) {
        keyCondition = 'PK = :pk AND dueDate BETWEEN :from AND :to';
        values[':from'] = from; values[':to'] = to;
    } else if (to) {
        keyCondition = 'PK = :pk AND dueDate <= :to';
        values[':to'] = to;
    } else {
        keyCondition = 'PK = :pk AND dueDate >= :from';
        values[':from'] = from;
    }

    const filterParts = ['begins_with(SK, :prefix)'];
    if (excludeCompleted) {
        filterParts.push('#status <> :completed');
        values[':completed'] = 'Completed'; names['#status'] = 'status';
    }
    if (q.priority) {
        filterParts.push('priority = :priority');
        values[':priority'] = q.priority;
    }

    const result = await db.send(new QueryCommand({
        TableName:                 TABLE,
        IndexName:                 'GSI2-TaskStatus',
        KeyConditionExpression:    keyCondition,
        FilterExpression:          filterParts.join(' AND '),
        ExpressionAttributeValues: values,
        ExpressionAttributeNames:  Object.keys(names).length ? names : undefined,
        Limit:                     pageSize,
        ExclusiveStartKey:         lastKey,
        ScanIndexForward:          true,
    }));

    const tasks = (result.Items ?? []).map(stripKeys);
    const nextToken = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null;
    return ok({ tasks, nextToken });
};

const getTask = async (uid: string, id: string): Promise<APIGatewayProxyResult> => {
    const result = await db.send(new GetCommand({ TableName: TABLE, Key: keys.task(uid, id) }));
    if (!result.Item) return notFound('Task not found');
    return ok(stripKeys(result.Item));
};

const addTask = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = stripTableKeys(parseBody<Task>(event));
    if (typeof body.title !== 'string' || !body.title.trim()) return badRequest('title is required');

    const item = { ...body, ...keys.task(uid, body.id) };  // keys MUST win
    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return created(stripKeys(item));
};

const updateTask = async (uid: string, id: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = stripTableKeys(parseBody<Task>(event));
    const item = { ...body, ...keys.task(uid, id), id };  // keys MUST win
    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return ok(stripKeys(item));
};

const deleteTask = async (uid: string, id: string): Promise<APIGatewayProxyResult> => {
    await db.send(new DeleteCommand({ TableName: TABLE, Key: keys.task(uid, id) }));
    return noContent();
};

const parseBody = <T>(event: APIGatewayProxyEvent): T => {
    if (!event.body) throw new Error('Missing request body');
    return JSON.parse(event.body) as T;
};

const stripKeys = (item: Record<string, unknown>): Record<string, unknown> => {
    const { PK, SK, ...rest } = item;
    void PK; void SK;
    return rest;
};

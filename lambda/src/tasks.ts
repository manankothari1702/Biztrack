import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys } from './lib/db';
import { ok, created, noContent, badRequest, notFound, serverError, getUid } from './lib/response';

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
        const uid    = getUid(event);
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
    const status   = q.status;   // 'Pending' | 'In Progress' | 'Completed' | 'Overdue' | undefined
    const priority = q.priority; // 'High' | 'Medium' | 'Low' | undefined
    const pageSize = Math.min(parseInt(q.limit ?? '50'), 200);
    const lastKey  = q.nextToken ? JSON.parse(Buffer.from(q.nextToken, 'base64').toString()) : undefined;

    const exprValues: Record<string, unknown> = {
        ':pk':     `USER#${uid}`,
        ':prefix': 'TASK#',
    };

    const filterParts: string[] = [];

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
        FilterExpression:          filterParts.length ? filterParts.join(' AND ') : 'begins_with(SK, :prefix)',
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

const getTask = async (uid: string, id: string): Promise<APIGatewayProxyResult> => {
    const result = await db.send(new GetCommand({ TableName: TABLE, Key: keys.task(uid, id) }));
    if (!result.Item) return notFound('Task not found');
    return ok(stripKeys(result.Item));
};

const addTask = async (uid: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = parseBody<Task>(event);
    if (!body.title) return badRequest('title is required');

    const item = { ...keys.task(uid, body.id), ...body };
    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return created(stripKeys(item));
};

const updateTask = async (uid: string, id: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const body = parseBody<Task>(event);
    const item = { ...keys.task(uid, id), ...body, id };
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

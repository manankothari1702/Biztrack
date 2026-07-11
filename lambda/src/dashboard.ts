import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE } from './lib/db';
import { ok, serverError, getUid, resolveCors } from './lib/response';
import { guardAccount } from './lib/accountGuard';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        resolveCors(event);
        const uid = getUid(event);
        const { blocked } = await guardAccount(uid);
        if (blocked) return blocked;

        const now = new Date();

        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);
        const todayIso   = todayEnd.toISOString();
        const nowIso     = now.toISOString();
        const nextWeek   = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + 7);
        const nextWeekIso = nextWeek.toISOString();

        // Run all queries in parallel
        const [
            dueClientsResult,
            upcomingResult,
            recentClientsResult,
            recentContactsResult,
            pendingTasksResult,
            highTasksResult,
        ] = await Promise.all([
            // Due calls (nextFollowUpDate <= today, Active)
            db.send(new QueryCommand({
                TableName:              TABLE,
                IndexName:              'GSI1-FollowUpDate',
                KeyConditionExpression: 'PK = :pk AND nextFollowUpDate <= :today',
                FilterExpression:       '#status = :active AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk':     `USER#${uid}`,
                    ':today':  todayIso,
                    ':active': 'Active',
                    ':prefix': 'CLIENT#',
                },
                ExpressionAttributeNames: { '#status': 'status' },
                Limit: 100,
                ScanIndexForward: true,
            })),

            // Upcoming follow-ups (today → next 7 days)
            db.send(new QueryCommand({
                TableName:              TABLE,
                IndexName:              'GSI1-FollowUpDate',
                KeyConditionExpression: 'PK = :pk AND nextFollowUpDate BETWEEN :now AND :nextWeek',
                FilterExpression:       '#status = :active AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk':       `USER#${uid}`,
                    ':now':      nowIso,
                    ':nextWeek': nextWeekIso,
                    ':active':   'Active',
                    ':prefix':   'CLIENT#',
                },
                ExpressionAttributeNames: { '#status': 'status' },
                Limit: 20,
                ScanIndexForward: true,
            })),

            // Recent clients (last 5 added) — scan clients, sort by createdAt
            db.send(new QueryCommand({
                TableName:              TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: { ':pk': `USER#${uid}`, ':prefix': 'CLIENT#' },
                Select:       'ALL_ATTRIBUTES',
                Limit:        100,
            })),

            // Recent contacts (lastContactDate set, most recent)
            db.send(new QueryCommand({
                TableName:              TABLE,
                KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
                FilterExpression:       'attribute_exists(lastContactDate)',
                ExpressionAttributeValues: { ':pk': `USER#${uid}`, ':prefix': 'CLIENT#' },
                Limit: 100,
            })),

            // Pending/In-Progress tasks count
            db.send(new QueryCommand({
                TableName:              TABLE,
                IndexName:              'GSI2-TaskStatus',
                KeyConditionExpression: 'PK = :pk',
                FilterExpression:       '#status <> :completed AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk':        `USER#${uid}`,
                    ':completed': 'Completed',
                    ':prefix':    'TASK#',
                },
                ExpressionAttributeNames: { '#status': 'status' },
                Select: 'COUNT',
            })),

            // High priority incomplete tasks
            db.send(new QueryCommand({
                TableName:              TABLE,
                IndexName:              'GSI2-TaskStatus',
                KeyConditionExpression: 'PK = :pk',
                FilterExpression:       '#status <> :completed AND priority = :high AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk':        `USER#${uid}`,
                    ':completed': 'Completed',
                    ':high':      'High',
                    ':prefix':    'TASK#',
                },
                ExpressionAttributeNames: { '#status': 'status' },
                Limit: 20,
                ScanIndexForward: true,
            })),
        ]);

        const dueClients   = (dueClientsResult.Items   ?? []).map(stripKeys);
        const upcoming     = (upcomingResult.Items      ?? []).map(stripKeys);
        const priorityTasks = (highTasksResult.Items   ?? []).map(stripKeys);

        // Recent clients: sort by createdAt desc, take 5
        const recentClients = (recentClientsResult.Items ?? [])
            .map(stripKeys)
            .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
            .slice(0, 5);

        // Recent contacts: sort by lastContactDate desc, take 5
        const recentContacts = (recentContactsResult.Items ?? [])
            .map(stripKeys)
            .sort((a, b) => String(b.lastContactDate ?? '').localeCompare(String(a.lastContactDate ?? '')))
            .slice(0, 5);

        // Overdue tasks count (dueDate < now)
        const overdueCount = priorityTasks.filter(t => String(t.dueDate ?? '') < nowIso).length;

        return ok({
            counts: {
                dueCalls:       dueClients.length,
                totalClients:   recentClientsResult.Count ?? 0,
                pendingTasks:   pendingTasksResult.Count  ?? 0,
                overdueTasks:   overdueCount,
                completedTasks: 0, // fetched separately if needed
            },
            dueClients,
            upcomingFollowUps: upcoming,
            priorityTasks,
            recentClients,
            recentContacts,
        });
    } catch (err) {
        return serverError(err);
    }
};

const stripKeys = (item: Record<string, unknown>): Record<string, unknown> => {
    const { PK, SK, ...rest } = item;
    void PK; void SK;
    return rest;
};

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import axios from 'axios';
import { db, TABLE, keys } from './lib/db';
import { ok, serverError, badRequest, getUid } from './lib/response';

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

const getSecret = async (name: string): Promise<string> => {
    const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    return res.Parameter?.Value ?? '';
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const uid = getUid(event);

        const [token, phoneNumberId, profileResult] = await Promise.all([
            getSecret('/biztrack/whatsapp/token'),
            getSecret('/biztrack/whatsapp/phone-id'),
            db.send(new GetCommand({ TableName: TABLE, Key: keys.profile(uid) })),
        ]);

        const profile = profileResult.Item;
        if (!profile) return badRequest('Profile not found');

        const phoneNumber = String(profile.phoneNumber ?? '');
        const countryCode = String(profile.countryCode ?? '+91').replace('+', '');
        const name        = String(profile.name ?? 'there');

        if (!phoneNumber) return badRequest('No phone number saved in your profile.');

        const today = new Date();
        today.setHours(23, 59, 59, 999);

        const [clientsResult, tasksResult] = await Promise.all([
            db.send(new QueryCommand({
                TableName:              TABLE,
                IndexName:              'GSI1-FollowUpDate',
                KeyConditionExpression: 'PK = :pk AND nextFollowUpDate <= :today',
                FilterExpression:       '#status = :active AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': `USER#${uid}`, ':today': today.toISOString(), ':active': 'Active', ':prefix': 'CLIENT#',
                },
                ExpressionAttributeNames: { '#status': 'status' },
                Limit: 50,
            })),
            db.send(new QueryCommand({
                TableName:              TABLE,
                IndexName:              'GSI2-TaskStatus',
                KeyConditionExpression: 'PK = :pk',
                FilterExpression:       '#status <> :done AND priority = :high AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': `USER#${uid}`, ':done': 'Completed', ':high': 'High', ':prefix': 'TASK#',
                },
                ExpressionAttributeNames: { '#status': 'status' },
                Limit: 20,
            })),
        ]);

        const dueClients = clientsResult.Items ?? [];
        const highTasks  = tasksResult.Items   ?? [];
        const message    = buildMessage(name, dueClients, highTasks);
        const to         = `${countryCode}${phoneNumber}`;

        await axios.post(
            `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } },
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );

        await db.send(new UpdateCommand({
            TableName: TABLE,
            Key: keys.profile(uid),
            UpdateExpression: 'SET lastReportSentAt = :t, lastReportStatus = :s',
            ExpressionAttributeValues: { ':t': new Date().toISOString(), ':s': 'delivered' },
        }));

        return ok({ success: true, sentTo: to });
    } catch (err) {
        return serverError(err);
    }
};

const buildMessage = (
    name: string,
    clients: Record<string, unknown>[],
    tasks: Record<string, unknown>[]
): string => {
    const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    let msg = `📋 *BizTrack Daily Report (Test)*\n📅 ${today}\nHi ${name}!\n\n`;

    msg += clients.length === 0
        ? `📞 *Calls Due Today*\n✅ All caught up!\n\n`
        : `📞 *Calls Due Today (${clients.length})*\n` +
          clients.slice(0, 10).map(c => `• ${c.clientName}`).join('\n') + '\n\n';

    msg += tasks.length === 0
        ? `✅ *High Priority Tasks*\nNone today.\n\n`
        : `⚡ *High Priority Tasks (${tasks.length})*\n` +
          tasks.map(t => `• ${t.title}`).join('\n') + '\n\n';

    msg += `_This is a test message from BizTrack_ ⚗️`;
    return msg;
};

import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import axios from 'axios';
import { db, TABLE } from './lib/db';

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

const getSecret = async (name: string): Promise<string> => {
    const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    return res.Parameter?.Value ?? '';
};

export const handler = async (): Promise<void> => {
    const [token, phoneNumberId] = await Promise.all([
        getSecret('/biztrack/whatsapp/token'),
        getSecret('/biztrack/whatsapp/phone-id'),
    ]);

    const now      = new Date();
    const hhmm     = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

    // Find all users whose reportScheduleSK starts with HH:MM
    const result = await db.send(new QueryCommand({
        TableName:              TABLE,
        IndexName:              'GSI5-ReportSchedule',
        KeyConditionExpression: 'reportSchedulePK = :pk AND begins_with(reportScheduleSK, :time)',
        ExpressionAttributeValues: {
            ':pk':   'REPORT_SCHEDULE',
            ':time': hhmm,
        },
    }));

    if (!result.Items || result.Items.length === 0) return;

    await Promise.allSettled(
        result.Items.map(item => sendReportForUser(item, token, phoneNumberId, now))
    );
};

const sendReportForUser = async (
    item: Record<string, unknown>,
    token: string,
    phoneNumberId: string,
    now: Date
): Promise<void> => {
    const uid         = String(item.uid ?? '');
    const phoneNumber = String(item.phoneNumber ?? '');
    const countryCode = String(item.countryCode ?? '91').replace('+', '');
    const name        = String(item.name ?? 'there');
    const timezone    = String(item.timezone ?? 'Asia/Kolkata');

    if (!uid || !phoneNumber) return;

    // Guard: don't send twice in same minute
    const lastSent = item.lastReportSentAt ? new Date(String(item.lastReportSentAt)) : null;
    if (lastSent && (now.getTime() - lastSent.getTime()) < 60_000) return;

    // Verify time matches user's local timezone
    const localTime = now.toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
    const reportTime = String(item.reportGenerationTime ?? '');
    if (localTime !== reportTime) return;

    try {
        const todayIso = new Date(now.setHours(23, 59, 59, 999)).toISOString();

        const [clientsResult, tasksResult] = await Promise.all([
            db.send(new QueryCommand({
                TableName:              TABLE,
                IndexName:              'GSI1-FollowUpDate',
                KeyConditionExpression: 'PK = :pk AND nextFollowUpDate <= :today',
                FilterExpression:       '#status = :active AND begins_with(SK, :prefix)',
                ExpressionAttributeValues: {
                    ':pk': `USER#${uid}`, ':today': todayIso, ':active': 'Active', ':prefix': 'CLIENT#',
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

        const dueClients  = clientsResult.Items  ?? [];
        const highTasks   = tasksResult.Items    ?? [];
        const message     = buildMessage(name, dueClients, highTasks);
        const to          = `${countryCode}${phoneNumber}`;

        await axios.post(
            `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } },
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );

        await db.send(new UpdateCommand({
            TableName: TABLE,
            Key: { PK: `USER#${uid}`, SK: 'PROFILE' },
            UpdateExpression: 'SET lastReportSentAt = :t, lastReportStatus = :s',
            ExpressionAttributeValues: { ':t': new Date().toISOString(), ':s': 'delivered' },
        }));

    } catch (err) {
        console.error(`WhatsApp send failed for ${uid}:`, err);
        await db.send(new UpdateCommand({
            TableName: TABLE,
            Key: { PK: `USER#${uid}`, SK: 'PROFILE' },
            UpdateExpression: 'SET lastReportSentAt = :t, lastReportStatus = :s',
            ExpressionAttributeValues: { ':t': new Date().toISOString(), ':s': 'failed' },
        })).catch(() => undefined);
    }
};

const buildMessage = (
    name: string,
    clients: Record<string, unknown>[],
    tasks: Record<string, unknown>[]
): string => {
    const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    let msg = `📋 *BizTrack Daily Report*\n📅 ${today}\nHi ${name}!\n\n`;

    if (clients.length === 0) {
        msg += `📞 *Calls Due Today*\n✅ All caught up!\n\n`;
    } else {
        msg += `📞 *Calls Due Today (${clients.length})*\n`;
        clients.slice(0, 15).forEach(c => {
            msg += `• ${String(c.clientName ?? '')}${c.frequency ? ` — ${c.frequency}` : ''}\n`;
        });
        if (clients.length > 15) msg += `…and ${clients.length - 15} more\n`;
        msg += '\n';
    }

    if (tasks.length === 0) {
        msg += `✅ *High Priority Tasks*\nNone today.\n\n`;
    } else {
        msg += `⚡ *High Priority Tasks (${tasks.length})*\n`;
        tasks.forEach(t => {
            const overdue = String(t.dueDate ?? '') < new Date().toISOString();
            msg += `• ${String(t.title ?? '')}${overdue ? ' ⚠️ Overdue' : ''}\n`;
        });
        msg += '\n';
    }

    msg += `_Sent by BizTrack • Have a productive day!_`;
    return msg;
};

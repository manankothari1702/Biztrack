import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import {
    GetSecretValueCommand,
    ResourceNotFoundException,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import axios from 'axios';
import { db, TABLE, keys } from './lib/db';
import { ok, serverError, badRequest, getUid, tooManyRequests, resolveCors } from './lib/response';
import { guardAccount } from './lib/accountGuard';

const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

// Same secrets, same semantics as whatsappScheduler.ts: an absent secret means the
// WhatsApp feature is not configured, and that is the ONLY failure swallowed here.
// AccessDenied, throttling, network and every other SDK error rethrow to the
// handler's catch and surface as a 500, because those are faults, not "feature off".
const getSecret = async (id: string): Promise<string> => {
    try {
        const res = await secrets.send(new GetSecretValueCommand({ SecretId: id }));
        return res.SecretString ?? '';
    } catch (err) {
        if (err instanceof ResourceNotFoundException) return '';
        throw err;
    }
};

// ── Per-user rate limit for test sends (audit A1) ───────────────────────────
// Caps test WhatsApp sends to a small daily budget AND a minimum interval so a
// single user can't burst-spam or run up messaging cost. Reserve the slot BEFORE
// sending (fail-closed on cost). Both the cap and the interval live in the
// ConditionExpression, and the increment is an atomic `ADD` inside DynamoDB, so the
// limit holds under concurrent requests (DynamoDB serializes conditional writes per
// item). The only read is on the pure-rejection path, to choose the error wording.
const DAILY_CAP = 10;
const MIN_INTERVAL_MS = 60 * 60 * 1000; // one send per hour

const enforceTestRateLimit = async (uid: string): Promise<APIGatewayProxyResult | null> => {
    const key    = { PK: `USER#${uid}`, SK: 'META#whatsapp-test' };
    const now    = new Date();
    const nowMs  = now.getTime();
    const nowIso = now.toISOString();
    const today  = nowIso.slice(0, 10);                              // YYYY-MM-DD (UTC)
    const minAgo = new Date(nowMs - MIN_INTERVAL_MS).toISOString();
    const ttl    = Math.floor(nowMs / 1000) + 2 * 24 * 60 * 60;

    const names = { '#d': 'dayKey', '#c': 'sendCount', '#l': 'lastSentAt' };
    const intervalOk = '(attribute_not_exists(#l) OR #l < :minAgo)';

    // Attempt 1 — same day: atomic increment, only if under cap AND interval elapsed.
    try {
        await db.send(new UpdateCommand({
            TableName: TABLE, Key: key,
            ExpressionAttributeNames: names,
            UpdateExpression: 'ADD #c :one SET #l = :now, expiresAt = :ttl',
            ConditionExpression: `#d = :today AND #c < :cap AND ${intervalOk}`,
            ExpressionAttributeValues: {
                ':one': 1, ':today': today, ':cap': DAILY_CAP,
                ':now': nowIso, ':ttl': ttl, ':minAgo': minAgo,
            },
        }));
        return null; // reserved
    } catch (err) {
        if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
    }

    // Attempt 2 — new day / first-ever: reset counter to 1, only if interval elapsed.
    try {
        await db.send(new UpdateCommand({
            TableName: TABLE, Key: key,
            ExpressionAttributeNames: names,
            UpdateExpression: 'SET #c = :one, #d = :today, #l = :now, expiresAt = :ttl',
            ConditionExpression: `(attribute_not_exists(#d) OR #d <> :today) AND ${intervalOk}`,
            ExpressionAttributeValues: {
                ':one': 1, ':today': today, ':now': nowIso, ':ttl': ttl, ':minAgo': minAgo,
            },
        }));
        return null; // reserved
    } catch (err) {
        if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
    }

    // Both reservations failed → genuinely limited. One read to craft the reason.
    const cur = await db.send(new GetCommand({ TableName: TABLE, Key: key }));
    const last = typeof cur.Item?.lastSentAt === 'string' ? cur.Item.lastSentAt : '';
    if (last && (nowMs - new Date(last).getTime()) < MIN_INTERVAL_MS) {
        const waitMin = Math.ceil((MIN_INTERVAL_MS - (nowMs - new Date(last).getTime())) / 60000);
        return tooManyRequests(`Please wait ~${waitMin} min before sending another test report.`,
            { retryAfterMinutes: waitMin });
    }
    return tooManyRequests(`Daily test-report limit reached (${DAILY_CAP}). Try again tomorrow.`);
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        resolveCors(event);
        const uid = getUid(event);
        const { blocked } = await guardAccount(uid);
        if (blocked) return blocked;

        // Reserve a send-slot (or reject) before doing any expensive work.
        const limited = await enforceTestRateLimit(uid);
        if (limited) return limited;

        const [token, phoneNumberId, profileResult] = await Promise.all([
            getSecret('biztrack/whatsapp/token'),
            getSecret('biztrack/whatsapp/phone-id'),
            db.send(new GetCommand({ TableName: TABLE, Key: keys.profile(uid) })),
        ]);

        // Not configured. The scheduler returns silently; an HTTP endpoint has to say
        // something, so this reports it as unavailable rather than letting an empty
        // token reach Meta and surface as an opaque 500.
        if (!token || !phoneNumberId) return badRequest('WhatsApp is not configured.');

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

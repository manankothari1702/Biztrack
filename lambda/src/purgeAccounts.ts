import {
    ScanCommand,
    QueryCommand,
    BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
    CognitoIdentityProviderClient,
    AdminDeleteUserCommand,
    UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { db, TABLE } from './lib/db';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';
const BATCH_SIZE = 25; // DynamoDB BatchWriteItem hard limit.

interface ProfileRow {
    PK: string;
    SK: string;
    accountStatus?: string;
    purgeAt?: string;
    [k: string]: unknown;
}

interface PurgeResult {
    scannedProfiles: number;
    purgedAccounts: number;
    deletedItems: number;
    errors: number;
    [k: string]: unknown;
}

const log = (level: 'info' | 'warn' | 'error', event: string, extra: Record<string, unknown> = {}) => {
    console.log(JSON.stringify({ level, event, ...extra }));
};

// Scan all PROFILE rows that are past their purge deadline. Sparse — most accounts
// are ACTIVE so the filter rejects them server-side. For very large user bases
// (>1M users) consider a sparse GSI keyed on accountStatus + purgeAt.
const findDuePurges = async (now: string): Promise<ProfileRow[]> => {
    const due: ProfileRow[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
        const res = await db.send(new ScanCommand({
            TableName: TABLE,
            FilterExpression: 'SK = :sk AND accountStatus = :ps AND purgeAt <= :now',
            ExpressionAttributeValues: {
                ':sk':  'PROFILE',
                ':ps':  'PENDING_DELETION',
                ':now': now,
            },
            ExclusiveStartKey: lastKey,
        }));
        for (const item of res.Items ?? []) due.push(item as ProfileRow);
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    return due;
};

// Delete every row with PK = USER#<uid>. Batched in chunks of 25. Returns count.
const purgeUserData = async (uid: string): Promise<number> => {
    const pk = `USER#${uid}`;
    let deleted = 0;
    let lastKey: Record<string, unknown> | undefined;

    do {
        const page = await db.send(new QueryCommand({
            TableName: TABLE,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': pk },
            ProjectionExpression: 'PK, SK',
            ExclusiveStartKey: lastKey,
        }));

        const items = (page.Items ?? []) as { PK: string; SK: string }[];
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const chunk = items.slice(i, i + BATCH_SIZE);
            const requests = chunk.map(({ PK, SK }) => ({
                DeleteRequest: { Key: { PK, SK } },
            }));

            // BatchWriteItem may leave unprocessed items under throttling — retry.
            let pending = requests;
            for (let attempt = 0; attempt < 5 && pending.length > 0; attempt++) {
                const res = await db.send(new BatchWriteCommand({
                    RequestItems: { [TABLE]: pending },
                }));
                const unprocessed = res.UnprocessedItems?.[TABLE] ?? [];
                deleted += pending.length - unprocessed.length;
                pending = unprocessed as typeof requests;
                if (pending.length > 0) {
                    // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
                    await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
                }
            }
            if (pending.length > 0) {
                log('error', 'purge_unprocessed_after_retries', { uid, remaining: pending.length });
                throw new Error(`Could not delete ${pending.length} items for ${uid}`);
            }
        }

        lastKey = page.LastEvaluatedKey;
    } while (lastKey);

    return deleted;
};

const deleteCognitoUser = async (uid: string): Promise<void> => {
    if (!USER_POOL_ID) {
        log('warn', 'cognito_delete_skipped_no_pool', { uid });
        return;
    }
    try {
        await cognito.send(new AdminDeleteUserCommand({
            UserPoolId: USER_POOL_ID,
            Username:   uid,
        }));
    } catch (err) {
        if (err instanceof UserNotFoundException) {
            // Already gone — idempotent success.
            log('info', 'cognito_user_already_deleted', { uid });
            return;
        }
        throw err;
    }
};

export const handler = async (): Promise<PurgeResult> => {
    const now = new Date().toISOString();
    log('info', 'purge_run_start', { now });

    const result: PurgeResult = {
        scannedProfiles: 0,
        purgedAccounts: 0,
        deletedItems: 0,
        errors: 0,
    };

    let duePurges: ProfileRow[];
    try {
        duePurges = await findDuePurges(now);
    } catch (err) {
        log('error', 'purge_scan_failed', { error: err instanceof Error ? err.message : String(err) });
        throw err; // Surface to EventBridge for alarms / retry.
    }

    result.scannedProfiles = duePurges.length;
    log('info', 'purge_candidates_found', { count: duePurges.length });

    // Sequential by user — bounded blast radius, simpler error accounting.
    for (const profile of duePurges) {
        const uid = profile.PK.replace(/^USER#/, '');
        try {
            // Delete DynamoDB rows FIRST (includes the profile itself).
            // If Cognito delete fails after, the next run won't find this user
            // (their profile is gone) — operator must clean up the Cognito user
            // manually, but data is already purged which is the privacy guarantee.
            const deleted = await purgeUserData(uid);
            await deleteCognitoUser(uid);

            result.purgedAccounts += 1;
            result.deletedItems += deleted;
            log('info', 'account_purged', { uid, deletedItems: deleted, purgeAt: profile.purgeAt });
        } catch (err) {
            result.errors += 1;
            log('error', 'account_purge_failed', {
                uid,
                error: err instanceof Error ? err.message : String(err),
            });
            // Continue to next user — one failure shouldn't block the rest.
        }
    }

    log('info', 'purge_run_complete', result);
    return result;
};

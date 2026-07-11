import { APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys } from './db';
import { corsHeaders } from './response';

export type AccountStatus = 'ACTIVE' | 'PENDING_DELETION';

export interface ProfileRecord {
    accountStatus?: AccountStatus;
    purgeAt?: string;
    deletedAt?: string;
    [k: string]: unknown;
}

const formatDate = (iso: string): string => {
    try {
        return new Date(iso).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
        });
    } catch {
        return iso;
    }
};

export const pendingDeletionResponse = (purgeAt?: string): APIGatewayProxyResult => {
    const friendly = purgeAt ? formatDate(purgeAt) : 'soon';
    return {
        statusCode: 403,
        headers: corsHeaders(),
        body: JSON.stringify({
            error: 'ACCOUNT_PENDING_DELETION',
            message: `Your account is scheduled for permanent deletion. Please contact support before ${friendly} if you want to restore your account.`,
            purgeAt: purgeAt ?? null,
        }),
    };
};

/**
 * Fetches the caller's profile and rejects the request if the account is
 * pending deletion. Callers must `return blocked` immediately when set.
 *
 * Treats a missing profile as ACTIVE — the PostConfirmation trigger creates
 * profiles, but legacy/edge accounts without one should still flow through
 * existing logic (which can return 404 itself).
 */
export const guardAccount = async (
    uid: string
): Promise<{ blocked?: APIGatewayProxyResult; profile: ProfileRecord | null }> => {
    const res = await db.send(new GetCommand({ TableName: TABLE, Key: keys.profile(uid) }));
    const profile = (res.Item ?? null) as ProfileRecord | null;

    if (profile?.accountStatus === 'PENDING_DELETION') {
        console.log(JSON.stringify({
            level: 'warn',
            event: 'account_blocked_pending_deletion',
            uid,
            purgeAt: profile.purgeAt,
        }));
        return { blocked: pendingDeletionResponse(profile.purgeAt), profile };
    }

    return { profile };
};

/**
 * One-shot backfill script.
 *
 * For every confirmed user in the Cognito User Pool, ensures a DynamoDB
 * PROFILE row exists with name, email, photoURL, provider, and createdAt.
 * Safe to re-run: uses ConditionExpression so existing rows are never overwritten.
 *
 * Usage:
 *   npx ts-node scripts/backfill-profiles.ts
 *
 * Required env vars (or set in .env):
 *   AWS_REGION                  (default: ap-south-1)
 *   VITE_COGNITO_USER_POOL_ID   pool id
 *   TABLE_NAME                  DynamoDB table (default: biztrack)
 */

import {
    CognitoIdentityProviderClient,
    ListUsersCommand,
    type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// ── Config ───────────────────────────────────────────────────────────────────

const REGION    = process.env.AWS_REGION         ?? 'ap-south-1';
const POOL_ID   = process.env.VITE_COGNITO_USER_POOL_ID ?? 'ap-south-1_2QhXH4Xjd';
const TABLE     = process.env.TABLE_NAME         ?? 'biztrack';

// ── Clients ──────────────────────────────────────────────────────────────────

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const dynamo  = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: REGION }),
    { marshallOptions: { removeUndefinedValues: true } }
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function attr(user: UserType, name: string): string {
    return user.Attributes?.find(a => a.Name === name)?.Value ?? '';
}

function resolveDisplayName(user: UserType, email: string): string {
    return (
        attr(user, 'name') ||
        [attr(user, 'given_name'), attr(user, 'family_name')].filter(Boolean).join(' ').trim() ||
        email.split('@')[0]
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`Backfilling profiles → Pool: ${POOL_ID}  Table: ${TABLE}\n`);

    let paginationToken: string | undefined;
    let totalUsers = 0;
    let created    = 0;
    let skipped    = 0;
    let errors     = 0;

    do {
        const res = await cognito.send(new ListUsersCommand({
            UserPoolId:      POOL_ID,
            PaginationToken: paginationToken,
            Limit:           60,
        }));

        for (const user of res.Users ?? []) {
            totalUsers++;
            const sub   = attr(user, 'sub');
            const email = attr(user, 'email');
            if (!sub) { console.warn('  SKIP (no sub):', user.Username); skipped++; continue; }

            const photoURL  = attr(user, 'picture');
            const isGoogle  = (user.UserStatus === 'EXTERNAL_PROVIDER') || photoURL !== '';

            try {
                await dynamo.send(new PutCommand({
                    TableName: TABLE,
                    Item: {
                        PK:        `USER#${sub}`,
                        SK:        'PROFILE',
                        email,
                        name:      resolveDisplayName(user, email),
                        photoURL,
                        level:     'Supervisor',
                        provider:  isGoogle ? 'google' : 'email',
                        createdAt: user.UserCreateDate?.toISOString() ?? new Date().toISOString(),
                    },
                    ConditionExpression: 'attribute_not_exists(PK)',
                }));
                console.log(`  CREATED  ${email} (${sub})`);
                created++;
            } catch (err: unknown) {
                const name = (err as { name?: string }).name ?? '';
                if (name === 'ConditionalCheckFailedException') {
                    console.log(`  EXISTS   ${email} (${sub})`);
                    skipped++;
                } else {
                    console.error(`  ERROR    ${email} (${sub}):`, err);
                    errors++;
                }
            }
        }

        paginationToken = res.PaginationToken;
    } while (paginationToken);

    console.log(`\nDone.  Total: ${totalUsers}  Created: ${created}  Skipped: ${skipped}  Errors: ${errors}`);
    if (errors > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });

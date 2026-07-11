import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys } from './lib/db';

interface CognitoEvent {
    triggerSource: string;
    request: { userAttributes: Record<string, string> };
    response: Record<string, never>;
}

export const handler = async (event: CognitoEvent): Promise<CognitoEvent> => {
    // Fires after a user confirms their email at sign-up.
    if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return event;

    const attrs = event.request.userAttributes;
    const sub   = attrs['sub'];
    if (!sub) return event;

    const email = attrs['email'] ?? '';
    const displayName = attrs['name'] || email.split('@')[0];

    try {
        await db.send(new PutCommand({
            TableName: TABLE,
            Item: {
                ...keys.profile(sub),
                email,
                name:      displayName,
                level:     'Supervisor',
                provider:  'email',
                createdAt: new Date().toISOString(),
            },
            // Idempotent — never overwrite an existing profile
            ConditionExpression: 'attribute_not_exists(PK)',
        }));
    } catch (err: unknown) {
        // ConditionalCheckFailedException means profile already exists — fine
        const errName = (err as { name?: string }).name ?? '';
        if (errName !== 'ConditionalCheckFailedException') {
            console.error('PostConfirmation trigger error:', err);
            // Don't throw — a Lambda error here would block the user from signing in
        }
    }

    return event;
};

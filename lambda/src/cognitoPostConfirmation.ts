import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys } from './lib/db';

interface CognitoEvent {
    triggerSource: string;
    request: { userAttributes: Record<string, string> };
    response: Record<string, never>;
}

export const handler = async (event: CognitoEvent): Promise<CognitoEvent> => {
    // Fires on email confirmation AND on first federated (Google) sign-in.
    // For Google users the trigger source is still PostConfirmation_ConfirmSignUp.
    if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return event;

    const attrs = event.request.userAttributes;
    const sub   = attrs['sub'];
    if (!sub) return event;

    const email = attrs['email'] ?? '';

    // Google sends display name as `name`; fall back to given+family, then email local-part
    const displayName =
        attrs['name'] ||
        [attrs['given_name'], attrs['family_name']].filter(Boolean).join(' ').trim() ||
        email.split('@')[0];

    // `picture` is enabled as a standard Cognito attribute and mapped from Google IdP
    const photoURL = attrs['picture'] ?? '';
    const isGoogle = !!attrs['identities'] || photoURL !== '';

    try {
        await db.send(new PutCommand({
            TableName: TABLE,
            Item: {
                ...keys.profile(sub),
                email,
                name:      displayName,
                photoURL,
                level:     'Supervisor',
                provider:  isGoogle ? 'google' : 'email',
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
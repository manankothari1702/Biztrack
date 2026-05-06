import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE, keys } from './lib/db';

interface CognitoEvent {
    triggerSource: string;
    request: { userAttributes: Record<string, string> };
    response: Record<string, never>;
}

export const handler = async (event: CognitoEvent): Promise<CognitoEvent> => {
    // Fires on email confirmation AND on first federated (Google) sign-in
    if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return event;

    const { sub, email, name, picture } = event.request.userAttributes;
    if (!sub) return event;

    try {
        await db.send(new PutCommand({
            TableName: TABLE,
            Item: {
                ...keys.profile(sub),
                email:     email   ?? '',
                name:      name    ?? '',
                photoURL:  picture ?? '',
                level:     'Root',
                provider:  picture ? 'google' : 'email',
                createdAt: new Date().toISOString(),
            },
            // Idempotent — never overwrite an existing profile
            ConditionExpression: 'attribute_not_exists(PK)',
        }));
    } catch (err: unknown) {
        // ConditionalCheckFailedException means profile already exists — that's fine
        const name = (err as { name?: string }).name ?? '';
        if (name !== 'ConditionalCheckFailedException') {
            console.error('PostConfirmation trigger error:', err);
            // Don't throw — Cognito would block sign-in if the trigger fails
        }
    }

    return event;
};
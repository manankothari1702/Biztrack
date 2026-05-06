import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

export const db = DynamoDBDocumentClient.from(client, {
    marshallOptions:   { removeUndefinedValues: true },
    unmarshallOptions: { wrapNumbers: false },
});

export const TABLE = process.env.TABLE_NAME ?? 'biztrack';

// Key helpers — single-table design
export const keys = {
    profile:  (uid: string) => ({ PK: `USER#${uid}`, SK: 'PROFILE' }),
    client:   (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `CLIENT#${id}` }),
    task:     (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `TASK#${id}` }),
    orgNode:  (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `ORG#${id}` }),
};

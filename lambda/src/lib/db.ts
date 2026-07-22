import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

export const db = DynamoDBDocumentClient.from(client, {
    marshallOptions:   { removeUndefinedValues: true },
    unmarshallOptions: { wrapNumbers: false },
});

export const TABLE = process.env.TABLE_NAME ?? 'biztrack';

// Invoice numbering counters — one per user per document type.
export type CounterType = 'SALE' | 'PURCHASE';

// Key helpers — single-table design
export const keys = {
    profile:  (uid: string) => ({ PK: `USER#${uid}`, SK: 'PROFILE' }),
    client:   (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `CLIENT#${id}` }),
    task:     (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `TASK#${id}` }),
    orgNode:  (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `ORG#${id}` }),

    // ── Inventory & invoicing ───────────────────────────────────────────────

    product:  (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `PRODUCT#${id}` }),

    // Expiry is IN the key, so a same-expiry restock is a single atomic
    // `UpdateItem … ADD quantity :q` and a new expiry is simply a new item.
    // List one product's batches with begins_with(SK, `BATCH#${productId}#`).
    batch:    (uid: string, productId: string, expiry: string) =>
                ({ PK: `USER#${uid}`, SK: `BATCH#${productId}#${expiry}` }),

    // createdAt leads the suffix so ScanIndexForward:false yields newest-first.
    stockMove:(uid: string, createdAt: string, id: string) =>
                ({ PK: `USER#${uid}`, SK: `STOCKMOVE#${createdAt}#${id}` }),

    // The client-generated id is the WHOLE suffix — that is what makes point
    // reads (get/finalize/cancel/delete by id) and the duplicate-submit guard
    // `attribute_not_exists(PK)` work. Chronological ordering comes from
    // GSI6-InventoryDate (invDate = createdAt), not from this sort key.
    invoice:  (uid: string, id: string) => ({ PK: `USER#${uid}`, SK: `INVOICE#${id}` }),

    counter:  (uid: string, type: CounterType) =>
                ({ PK: `USER#${uid}`, SK: `COUNTER#${type}` }),
};

/**
 * Strip DynamoDB table-key attributes from a client-supplied object.
 *
 * Without this, a write handler that spreads request bodies — e.g.
 * `{ ...keys.client(uid, id), ...body }` — lets a caller override the
 * `PK`/`SK` it computed, writing into another user's partition.
 *
 * Always run incoming bodies through this before merging with key helpers,
 * and spread keys *last* so they win regardless of order.
 */
export const stripTableKeys = <T>(body: T): T => {
    if (!body || typeof body !== 'object') return body;
    const { PK, SK, ...rest } = body as Record<string, unknown>;
    void PK; void SK;
    return rest as T;
};

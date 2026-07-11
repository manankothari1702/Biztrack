import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE } from './db';

export type WriteReq = {
    PutRequest?:    { Item: Record<string, unknown> };
    DeleteRequest?: { Key: Record<string, unknown> };
};

// 20s budget under the 29s Lambda / API Gateway timeout. Callers that make MULTIPLE
// batchWriteAll calls in one invocation (e.g. the level-by-level org delete) must compute
// ONE deadline at handler entry and pass the same value to every call — never a fresh
// budget per call — so a deep/multi-step operation can't push the total past 29s while each
// individual call looks in-budget.
export const BULK_DEADLINE_MS = 20_000;

// Writes all requests via BatchWrite in chunks of 25, retrying UnprocessedItems with
// exponential backoff. Returns the count that ACTUALLY persisted (not attempted) plus
// whether it stopped early on the deadline. NOT atomic. Unlike purgeAccounts (a cron that
// throws on leftovers to raise an alarm), this serves interactive requests: leftover items
// after retries are reported honestly as un-persisted rather than failing the whole request
// after some rows already landed. The deadline is checked BEFORE each chunk, retry, and
// backoff, so at most one in-flight send runs past it before a graceful partial return:
//   deadline + ~7s worst in-flight send + ~1s serialize/return < 29s.
// `send` is injectable for unit testing.
export const batchWriteAll = async (
    requests: WriteReq[],
    deadline: number,
    send: (items: WriteReq[]) => Promise<{ UnprocessedItems?: Record<string, unknown[]> }>
        = (items) => db.send(new BatchWriteCommand({ RequestItems: { [TABLE]: items } })),
): Promise<{ persisted: number; timedOut: boolean }> => {
    let persisted = 0;
    for (let i = 0; i < requests.length; i += 25) {
        if (Date.now() >= deadline) return { persisted, timedOut: true }; // before a chunk
        let pending = requests.slice(i, i + 25);
        for (let attempt = 0; attempt < 5 && pending.length > 0; attempt++) {
            if (attempt > 0 && Date.now() >= deadline) return { persisted, timedOut: true }; // before a retry
            const res = await send(pending);
            const unprocessed = (res.UnprocessedItems?.[TABLE] ?? []) as WriteReq[];
            persisted += pending.length - unprocessed.length;
            pending = unprocessed;
            if (pending.length > 0 && attempt < 4) { // only sleep if another attempt follows
                if (Date.now() >= deadline) return { persisted, timedOut: true }; // before backoff
                await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
            }
        }
        // leftover `pending` after 5 attempts is intentionally NOT counted — honest partial.
    }
    return { persisted, timedOut: false };
};

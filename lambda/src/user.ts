import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
    CognitoIdentityProviderClient,
    AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { db, TABLE, keys } from './lib/db';
import { ok, badRequest, notFound, serverError, forbidden, getUid, getEmail, resolveCors } from './lib/response';
import { guardAccount, pendingDeletionResponse } from './lib/accountGuard';
import { stripTableKeys } from './lib/sanitize';
import { batchWriteAll, BULK_DEADLINE_MS, type WriteReq } from './lib/batch';

const PURGE_DELAY_DAYS = 7;
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        resolveCors(event);
        const uid    = getUid(event);
        const email  = getEmail(event);
        const method = event.httpMethod;
        const path   = event.resource ?? event.path;
        const nodeId = event.pathParameters?.nodeId;

        // ── DELETE /user — initiate soft-delete (account deletion request) ──
        // No guard: a pending-deletion user calling DELETE again is idempotent.
        if (path === '/user' && method === 'DELETE') {
            return await initiateAccountDeletion(uid);
        }

        // All other routes require an active account.
        const { blocked, profile } = await guardAccount(uid);
        if (blocked) return blocked;

        // /user/org/{nodeId}
        if (path.includes('/org/') && nodeId) {
            if (method === 'PUT')    return await updateOrgNode(uid, nodeId, event);
            if (method === 'DELETE') return await deleteOrgNode(uid, nodeId);
        }

        // /user/org
        if (path.endsWith('/org')) {
            if (method === 'GET')  return await listOrgNodes(uid);
            if (method === 'POST') return await addOrgNode(uid, event, profile);
        }

        // /user
        if (method === 'GET') return await getProfile(uid);
        if (method === 'PUT') return await updateProfile(uid, event, profile, email);

        return badRequest('Unknown route');
    } catch (err) {
        return serverError(err);
    }
};

// ── Account deletion (soft) ────────────────────────────────────────────────

const initiateAccountDeletion = async (uid: string): Promise<APIGatewayProxyResult> => {
    const existing = await db.send(new GetCommand({ TableName: TABLE, Key: keys.profile(uid) }));
    const profile = (existing.Item ?? {}) as Record<string, unknown>;

    // Idempotent — already pending: return the same response so retries are safe.
    if (profile.accountStatus === 'PENDING_DELETION') {
        return pendingDeletionResponse(profile.purgeAt as string | undefined);
    }

    const now = new Date();
    const purgeAt = new Date(now.getTime() + PURGE_DELAY_DAYS * 24 * 60 * 60 * 1000);
    const deletedAt = now.toISOString();
    const purgeAtIso = purgeAt.toISOString();

    const updated = {
        ...profile,
        ...keys.profile(uid),
        accountStatus: 'PENDING_DELETION',
        deletedAt,
        purgeAt: purgeAtIso,
        // Tombstone: scrub the report scheduler keys so the WhatsApp cron skips this user.
        reportSchedulePK: undefined,
        reportScheduleSK: undefined,
    };

    await db.send(new PutCommand({ TableName: TABLE, Item: updated }));

    // Invalidate all refresh tokens. Access tokens may still work until they expire,
    // but the per-request accountGuard rejects them with 403 either way.
    if (USER_POOL_ID) {
        try {
            await cognito.send(new AdminUserGlobalSignOutCommand({
                UserPoolId: USER_POOL_ID,
                Username:   uid,
            }));
        } catch (err) {
            // Don't fail the delete request just because global sign-out failed —
            // the accountGuard still blocks the user. Log and continue.
            console.error(JSON.stringify({
                level: 'error',
                event: 'global_signout_failed',
                uid,
                error: err instanceof Error ? err.message : String(err),
            }));
        }
    }

    console.log(JSON.stringify({
        level: 'info',
        event: 'account_deletion_requested',
        uid,
        deletedAt,
        purgeAt: purgeAtIso,
    }));

    return ok({
        accountStatus: 'PENDING_DELETION',
        deletedAt,
        purgeAt: purgeAtIso,
    });
};

// ── Profile ────────────────────────────────────────────────────────────────

const getProfile = async (uid: string): Promise<APIGatewayProxyResult> => {
    const result = await db.send(new GetCommand({ TableName: TABLE, Key: keys.profile(uid) }));
    if (!result.Item) return notFound('Profile not found');
    return ok(stripKeys(result.Item));
};

// Fields a client may set on its own profile. Everything else is server-managed
// (createdAt, provider, avatarColor, lastReport*, account*), JWT-derived (email),
// or internal (reportSchedulePK/SK, uid) and is never honoured from the body.
const EDITABLE_PROFILE_FIELDS = [
    'name', 'level', 'phoneNumber', 'countryCode',
    'timezone', 'reportGenerationTime', 'reportEnabled', 'photoURL',
] as const;

// Format-only phone validation (E.164-ish). Empty pair = clearing the number (allowed).
// Deliberately does NOT prove ownership of the number — that's a separate, deferred
// Cognito phone-verification item. This blocks garbage and bounds length only.
const validatePhone = (countryCode: string, phoneNumber: string): string | null => {
    const cc = countryCode.replace(/\D/g, '');
    const pn = phoneNumber.replace(/\D/g, '');
    if (!cc && !pn) return null;
    if (cc.length < 1 || cc.length > 4)  return 'Invalid country code';
    if (pn.length < 4 || pn.length > 15) return 'Invalid phone number';
    if (cc.length + pn.length > 15)      return 'Phone number too long';
    return null;
};

const isValidTimeZone = (tz: string): boolean => {
    if (!tz) return false;
    try { Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
    catch { return false; }   // RangeError on unknown zone
};

const MAX_PHOTO_BYTES   = 200 * 1024; // 200 KB decoded — matches the frontend cap
const MAX_PHOTO_URL_LEN = 2048;       // remote avatar URL (e.g. Google `picture`)
// base64 is ~4/3 of decoded size; char ceiling for a 200KB payload + small header slack.
const MAX_PHOTO_DATAURL_LEN = Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 64; // ~273,132 chars

// Anchored, bounded prefix (mime subtype capped at 32) — linear, cannot backtrack.
const DATA_URL_PREFIX = /^data:image\/[a-z0-9.+-]{1,32};base64,/i;
// Single character class, no nesting — O(n), no catastrophic backtracking.
const BASE64_ONLY = /^[A-Za-z0-9+/=]+$/;

// photoURL may be: empty (clearing), a remote http(s) avatar URL, or an inline image
// data URL. Data URLs are capped on DECODED bytes; remote URLs on length.
//
// https CARVE-OUT (recorded decision): any external http(s) URL up to MAX_PHOTO_URL_LEN
// is accepted, NOT just Google's CDN — domain-allowlisting the avatar host is more
// fragile than it's worth. Tradeoff: the field can hold an arbitrary external URL that
// each profile viewer's browser fetches on <img src> render (a minor, self-scoped
// hotlink/tracking vector). Accepted because it is stored-only (never server-fetched →
// no SSRF) and the http(s)/data:image prefixes exclude javascript: and data:non-image
// (→ no stored XSS).
const validatePhoto = (photoURL: string): string | null => {
    if (!photoURL) return null; // clearing the photo is allowed

    // Remote URL. The `^https?://` test is anchored and inspects only the leading chars
    // (O(1), no backtracking), so it is safe to run before the length gate; the length
    // check itself bounds this branch.
    if (/^https?:\/\//i.test(photoURL)) {
        return photoURL.length > MAX_PHOTO_URL_LEN ? 'Photo URL too long' : null;
    }

    // Data-URL branch: LENGTH-GATE FIRST, before ANY pattern match, so a long adversarial
    // string can never drive regex backtracking / CPU (ReDoS). Only after this bound do we
    // run the (already linear) prefix + base64 checks on the size-limited input.
    if (photoURL.length > MAX_PHOTO_DATAURL_LEN) return 'Profile photo must be under 200 KB';

    const m = DATA_URL_PREFIX.exec(photoURL);
    if (!m) return 'Invalid photo format';
    const b64 = photoURL.slice(m[0].length).replace(/\s/g, '');
    if (!BASE64_ONLY.test(b64)) return 'Invalid photo format';
    const bytes = Buffer.from(b64, 'base64').length; // exact decoded size
    return bytes > MAX_PHOTO_BYTES ? 'Profile photo must be under 200 KB' : null;
};

const updateProfile = async (
    uid: string,
    event: APIGatewayProxyEvent,
    existing: Record<string, unknown> | null,
    email: string,
): Promise<APIGatewayProxyResult> => {
    if (!event.body) return badRequest('Missing body');
    const body = stripTableKeys(JSON.parse(event.body)) as Record<string, unknown>;

    // 1. WHITELIST — copy only client-editable fields. Drops reportSchedulePK/SK, uid,
    //    lastReport*, accountStatus, and any arbitrary extra keys the caller sent.
    const updates: Record<string, unknown> = {};
    for (const f of EDITABLE_PROFILE_FIELDS) {
        if (body[f] !== undefined) updates[f] = body[f];
    }

    // 2. VALIDATE phone only when it's being changed.
    if (updates.phoneNumber !== undefined || updates.countryCode !== undefined) {
        const phoneNumber = String(updates.phoneNumber ?? existing?.phoneNumber ?? '');
        const countryCode = String(updates.countryCode ?? existing?.countryCode ?? '');
        const err = validatePhone(countryCode, phoneNumber);
        if (err) return badRequest(err);
    }
    if (updates.photoURL !== undefined) {
        const err = validatePhoto(String(updates.photoURL));
        if (err) return badRequest(err);
    }
    if (updates.reportEnabled !== undefined && typeof updates.reportEnabled !== 'boolean') {
        return badRequest('reportEnabled must be a boolean');
    }

    // 3. MERGE over the existing record so server-managed fields survive the full Put.
    const base = (existing ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = {
        ...base,
        ...updates,
        ...keys.profile(uid),                                   // keys MUST win
        uid,                                                     // server-set, == owner
        email: (typeof base.email === 'string' && base.email) ? base.email : email,
    };
    // createdAt: stamp ONLY on genuine first creation. Never fabricate/backfill on an
    // edit — an existing row missing createdAt keeps it absent (backfill historical rows
    // via the Cognito-UserCreateDate-sourced scripts/backfill-profiles.ts, not here).
    if (!existing) merged.createdAt = new Date().toISOString();

    // 4. Derive schedule GSI keys server-side — but ONLY when this request is actually
    //    changing report settings. A name-only edit on a row with a stale reportEnabled/
    //    timezone must pass through untouched (schedule keys preserved from ...base),
    //    never re-validated, so users are never locked out of unrelated edits.
    const touchesReportSettings =
        updates.reportEnabled        !== undefined ||
        updates.reportGenerationTime !== undefined ||
        updates.timezone             !== undefined;

    if (touchesReportSettings) {
        if (merged.reportEnabled === true) {
            const reportTime = String(merged.reportGenerationTime ?? '');
            const tz         = String(merged.timezone ?? '');
            if (!/^\d{2}:\d{2}$/.test(reportTime)) {
                return badRequest('reportGenerationTime must be HH:MM to enable reports');
            }
            if (!isValidTimeZone(tz)) {
                return badRequest('A valid timezone is required to enable reports');
            }
            merged.reportSchedulePK = `REPORT_SCHEDULE#${reportTime.slice(0, 2)}`;  // hour bucket
            merged.reportScheduleSK = `${reportTime}#${tz}#${uid}`;
        } else {
            delete merged.reportSchedulePK;   // full Put + delete = attribute cleared
            delete merged.reportScheduleSK;
        }
    }

    await db.send(new PutCommand({ TableName: TABLE, Item: merged }));
    return ok(stripKeys(merged));
};

// ── Org Nodes ──────────────────────────────────────────────────────────────

const listOrgNodes = async (uid: string): Promise<APIGatewayProxyResult> => {
    const result = await db.send(new QueryCommand({
        TableName:              TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${uid}`, ':prefix': 'ORG#' },
    }));
    return ok({ orgNodes: (result.Items ?? []).map(stripKeys) });
};

const addOrgNode = async (
    uid: string,
    event: APIGatewayProxyEvent,
    profile: Record<string, unknown> | null,
): Promise<APIGatewayProxyResult> => {
    if (!event.body) return badRequest('Missing body');
    const node = stripTableKeys(JSON.parse(event.body));
    if (typeof node.id !== 'string' || !node.id) return badRequest('id is required');

    // Per-account node cap (audit B3). Cached counter (free — from guardAccount); confirm with
    // an authoritative COUNT before rejecting so counter drift can't false-lock a user who is
    // actually below the cap (same guard as the client cap).
    if (Number(profile?.orgNodeCount ?? 0) >= ORG_NODE_CAP) {
        const actual = await countOrgNodes(uid);
        if (actual >= ORG_NODE_CAP) {
            return forbidden('ORG_NODE_LIMIT_REACHED',
                `You've reached the ${ORG_NODE_CAP.toLocaleString()} team-member limit.`,
                { current: actual, limit: ORG_NODE_CAP });
        }
        await setOrgNodeCount(uid, actual); // heal drift so the user isn't stuck
    }

    const item = { ...node, ...keys.orgNode(uid, node.id) };  // keys MUST win
    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    await adjustOrgNodeCount(uid, 1);
    return ok(stripKeys(item));
};

const updateOrgNode = async (uid: string, nodeId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (!event.body) return badRequest('Missing body');
    const node = stripTableKeys(JSON.parse(event.body));
    const item = { ...node, ...keys.orgNode(uid, nodeId), id: nodeId };  // keys MUST win
    await db.send(new PutCommand({ TableName: TABLE, Item: item }));
    return ok(stripKeys(item));
};

// Server-side recursive subtree delete (audit B3). Replaces the old client-side Promise.all
// of individual DELETEs that orphaned subtrees on a mid-way failure. Deletes deepest level
// first with a per-level completion barrier, so a parent and child are never in the same
// batch — a partial failure leaves shallower levels (incl. the subtree root) intact and
// connected to root, never orphaned. Owner-scoped: the subtree is derived only from
// USER#{uid} nodes; a nodeId pointing elsewhere simply resolves to nothing here.
const deleteOrgNode = async (uid: string, nodeId: string): Promise<APIGatewayProxyResult> => {
    const all      = await listAllOrgNodes(uid);
    const levels   = collectSubtreeLevels(all, nodeId);   // deepest-first, malformed/cycle-safe
    const requested = levels.reduce((sum, l) => sum + l.length, 0);

    // ONE deadline for the whole invocation, shared across every per-level call — so a deep
    // tree can't push the total past the 29s timeout while each level looks in-budget.
    const deadline = Date.now() + BULK_DEADLINE_MS;
    const deletedIds: string[] = [];
    let partial = false;

    for (const level of levels) {
        const requests: WriteReq[] = level.map(id => ({ DeleteRequest: { Key: keys.orgNode(uid, id) } }));
        const { persisted, timedOut } = await batchWriteAll(requests, deadline);
        if (persisted === level.length && !timedOut) {
            deletedIds.push(...level);   // whole level confirmed gone
        } else {
            partial = true;              // stop — shallower levels survive, connected. Orphan-safe.
            break;
        }
    }

    // Decrement by ACTUAL deleted (not requested) so a partial delete can't leave the counter
    // overcounting and eventually false-locking the user out of adding nodes.
    if (deletedIds.length) await adjustOrgNodeCount(uid, -deletedIds.length);

    return ok({ deletedIds, requested, partial });
};

// ── Org node cap + subtree collection (audit B3) ────────────────────────────

const ORG_NODE_CAP = 2000;

// Full node set for a user (owner-scoped, paginated). id derived from SK so a missing `id`
// attribute on a malformed row can't hide it.
const listAllOrgNodes = async (uid: string): Promise<{ id: string; parentId: string | null }[]> => {
    const out: { id: string; parentId: string | null }[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const r = await db.send(new QueryCommand({
            TableName:                 TABLE,
            KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': `USER#${uid}`, ':prefix': 'ORG#' },
            ProjectionExpression:      'SK, parentId',
            ExclusiveStartKey:         lastKey,
        }));
        for (const item of r.Items ?? []) {
            const sk = String(item.SK ?? '');
            out.push({ id: sk.replace(/^ORG#/, ''), parentId: (item.parentId ?? null) as string | null });
        }
        lastKey = r.LastEvaluatedKey;
    } while (lastKey);
    return out;
};

// Collect the subtree rooted at nodeId as depth-grouped levels (deepest first). BFS DOWN via
// a complete children map (built from ALL nodes so no child is ever missed) with a visited
// set — so it terminates on cycles and collects malformed/cyclic nodes rather than stranding
// them. Never walks parent chains, so a broken/circular parentId can't break collection.
export const collectSubtreeLevels = (
    nodes: { id: string; parentId: string | null }[],
    nodeId: string,
): string[][] => {
    const childrenByParent = new Map<string, string[]>();
    for (const n of nodes) {
        if (n.parentId != null) {
            const arr = childrenByParent.get(n.parentId) ?? [];
            arr.push(n.id);
            childrenByParent.set(n.parentId, arr);
        }
    }

    const depthOf = new Map<string, number>();
    const queue: Array<[string, number]> = [[nodeId, 0]];
    depthOf.set(nodeId, 0);
    for (let h = 0; h < queue.length; h++) {
        const [id, d] = queue[h];
        for (const child of childrenByParent.get(id) ?? []) {
            if (!depthOf.has(child)) { depthOf.set(child, d + 1); queue.push([child, d + 1]); }
        }
    }

    const byDepth = new Map<number, string[]>();
    for (const [id, d] of depthOf) {
        const arr = byDepth.get(d) ?? [];
        arr.push(id);
        byDepth.set(d, arr);
    }
    return [...byDepth.keys()].sort((a, b) => b - a).map(d => byDepth.get(d)!); // deepest-first
};

const countOrgNodes = async (uid: string): Promise<number> => {
    let count = 0;
    let lastKey: Record<string, unknown> | undefined;
    do {
        const r = await db.send(new QueryCommand({
            TableName:                 TABLE,
            KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': `USER#${uid}`, ':prefix': 'ORG#' },
            Select:                    'COUNT',
            ExclusiveStartKey:         lastKey,
        }));
        count += r.Count ?? 0;
        lastKey = r.LastEvaluatedKey;
    } while (lastKey);
    return count;
};

const adjustOrgNodeCount = async (uid: string, delta: number): Promise<void> => {
    try {
        await db.send(new UpdateCommand({
            TableName:                 TABLE,
            Key:                       keys.profile(uid),
            UpdateExpression:          'ADD orgNodeCount :d',
            ExpressionAttributeValues: { ':d': delta },
        }));
    } catch { /* best-effort — reconciled at the cap cliff */ }
};

const setOrgNodeCount = async (uid: string, n: number): Promise<void> => {
    try {
        await db.send(new UpdateCommand({
            TableName:                 TABLE,
            Key:                       keys.profile(uid),
            UpdateExpression:          'SET orgNodeCount = :n',
            ExpressionAttributeValues: { ':n': n },
        }));
    } catch { /* best-effort */ }
};

// ── Helpers ────────────────────────────────────────────────────────────────

const stripKeys = (item: Record<string, unknown>): Record<string, unknown> => {
    const { PK, SK, ...rest } = item;
    void PK; void SK;
    return rest;
};

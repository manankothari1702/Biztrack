import { APIGatewayProxyResult } from 'aws-lambda';

// CORS allowlist (audit C3) — set by the stack from the CloudFront domain (+ localhost only
// in dev). Empty in local/test → falls back to no origin, which is fine there.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);

// A single Access-Control-Allow-Origin header can name only ONE origin, so we echo the
// caller's origin when it's in the allowlist (else fall back to the primary/prod origin).
// Safe as module state: a Lambda container serves one invocation at a time and resolveCors()
// runs before any response is built.
let requestOrigin = ALLOWED_ORIGINS[0] ?? '';

// Call once at the start of every API handler (before building any response).
export const resolveCors = (event: { headers?: Record<string, string | undefined> | null }): void => {
    const h = event.headers ?? {};
    const origin = h.origin ?? h.Origin ?? '';
    requestOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : (ALLOWED_ORIGINS[0] ?? '');
};

export const corsHeaders = (): Record<string, string> => ({
    'Access-Control-Allow-Origin':  requestOrigin,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
});

export const ok = (body: unknown): APIGatewayProxyResult => ({
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify(body),
});

export const created = (body: unknown): APIGatewayProxyResult => ({
    statusCode: 201,
    headers: corsHeaders(),
    body: JSON.stringify(body),
});

export const noContent = (): APIGatewayProxyResult => ({
    statusCode: 204,
    headers: corsHeaders(),
    body: '',
});

// Two error shapes coexist in this API, deliberately.
//
//   LEGACY  { error: "<human sentence>" }          — clients / tasks / user / whatsapp
//   CODED   { error: "CODE", message: "…", … }     — forbidden, tooManyRequests, and
//                                                    every inventory/invoicing endpoint
//
// The coded shape is what `05_API_CONTRACT.md` §0 mandates: the frontend maps
// `body.error` onto `ApiError.code` and branches on it (INSUFFICIENT_STOCK,
// DUPLICATE, …), which a human sentence cannot support. The legacy shape stays
// exactly as-is because the shipped clients/tasks contract depends on it — do
// not "harmonise" it without changing those consumers first.

/**
 * 400 Bad Request.
 *
 * - `badRequest(message)` — legacy shape `{ error: message }`. Existing handlers.
 * - `badRequest(code, message, extra?)` — coded shape. Use in new handlers.
 *
 * The two are distinguished by arity, so the legacy form is byte-identical to
 * what it produced before the overload was added.
 */
export function badRequest(message: string): APIGatewayProxyResult;
export function badRequest(
    code: string,
    message: string,
    extra?: Record<string, unknown>,
): APIGatewayProxyResult;
export function badRequest(
    codeOrMessage: string,
    message?: string,
    extra: Record<string, unknown> = {},
): APIGatewayProxyResult {
    const body = message === undefined
        ? { error: codeOrMessage }                              // legacy: sentence in `error`
        : { error: codeOrMessage, message, ...extra };          // coded
    return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify(body),
    };
}

/**
 * 404 Not Found. Overloaded by arity, exactly like `badRequest` above.
 *
 * - `notFound(message?)` — legacy shape `{ error: message }`. Existing handlers.
 * - `notFound(code, message, extra?)` — coded shape. New handlers, per the
 *   contract's `404 NOT_FOUND`.
 */
export function notFound(message?: string): APIGatewayProxyResult;
export function notFound(
    code: string,
    message: string,
    extra?: Record<string, unknown>,
): APIGatewayProxyResult;
export function notFound(
    codeOrMessage = 'Not found',
    message?: string,
    extra: Record<string, unknown> = {},
): APIGatewayProxyResult {
    const body = message === undefined
        ? { error: codeOrMessage }
        : { error: codeOrMessage, message, ...extra };
    return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify(body),
    };
}

/**
 * 401 Unauthenticated. `getUid` throws when the authorizer context is missing;
 * new handlers catch that and return this instead of letting it fall through to
 * `serverError` as a 500 (the contract promises 401).
 */
export const unauthorized = (
    message = 'Authentication required',
): APIGatewayProxyResult => ({
    statusCode: 401,
    headers: corsHeaders(),
    body: JSON.stringify({ error: 'UNAUTHENTICATED', message }),
});

export const forbidden = (
    error: string,
    message: string,
    extra: Record<string, unknown> = {},
): APIGatewayProxyResult => ({
    statusCode: 403,
    headers: corsHeaders(),
    body: JSON.stringify({ error, message, ...extra }),
});

/**
 * 405 Method Not Allowed — the route exists but not for this verb.
 *
 * Carries the `Allow` header the HTTP spec requires. Used by read-only
 * endpoints: `/stock-movements` is a projection of what the stock engine wrote,
 * so there is deliberately no way to POST one.
 */
export const methodNotAllowed = (
    allowed: readonly string[],
    message?: string,
): APIGatewayProxyResult => ({
    statusCode: 405,
    headers: { ...corsHeaders(), 'Allow': allowed.join(', ') },
    body: JSON.stringify({
        error: 'METHOD_NOT_ALLOWED',
        message: message ?? `This endpoint accepts ${allowed.join(', ')} only`,
    }),
});

/**
 * 409 Conflict — the request is well-formed but collides with current state.
 *
 * `extra` carries the context the UI needs to act on the failure, e.g.
 *   conflict('INSUFFICIENT_STOCK', 'Not enough stock in the selected batch (5 available)',
 *            { productId, expiryDate, available: 5 })
 *
 * Codes in use: INSUFFICIENT_STOCK · DUPLICATE · NOT_DRAFT · STOCK_ALREADY_SOLD
 * · BATCH_EMPTY (see `05_API_CONTRACT.md` §0).
 */
export const conflict = (
    error: string,
    message: string,
    extra: Record<string, unknown> = {},
): APIGatewayProxyResult => ({
    statusCode: 409,
    headers: corsHeaders(),
    body: JSON.stringify({ error, message, ...extra }),
});

export const tooManyRequests = (
    message: string,
    extra: Record<string, unknown> = {},
): APIGatewayProxyResult => ({
    statusCode: 429,
    headers: corsHeaders(),
    body: JSON.stringify({ error: 'RATE_LIMITED', message, ...extra }),
});

export const serverError = (err: unknown): APIGatewayProxyResult => {
    console.error('Unhandled error:', err);
    return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Internal server error' }),
    };
};

// Extract Cognito user ID from API Gateway authorizer context
export const getUid = (event: { requestContext: { authorizer: unknown } }): string => {
    const authorizer = event.requestContext?.authorizer as { claims?: { sub?: string } } | null;
    const sub = authorizer?.claims?.sub;
    if (!sub) throw new Error('Unauthenticated');
    return sub;
};

/**
 * Non-throwing sibling of `getUid` — returns `null` when the authorizer context
 * carries no `sub`.
 *
 * `getUid`'s throw is indistinguishable from a genuine fault once it reaches a
 * handler's catch-all, so it surfaces as a 500 rather than the 401 the contract
 * promises. New handlers open with:
 *
 *     const uid = tryGetUid(event);
 *     if (!uid) return unauthorized();
 *
 * `getUid` is deliberately left untouched — clients.ts and tasks.ts still use it.
 */
export const tryGetUid = (event: { requestContext: { authorizer: unknown } }): string | null => {
    const authorizer = event.requestContext?.authorizer as { claims?: { sub?: string } } | null;
    return authorizer?.claims?.sub ?? null;
};

// Extract the verified email claim from the Cognito ID token.
export const getEmail = (event: { requestContext: { authorizer: unknown } }): string => {
    const authorizer = event.requestContext?.authorizer as { claims?: { email?: string } } | null;
    return authorizer?.claims?.email ?? '';
};

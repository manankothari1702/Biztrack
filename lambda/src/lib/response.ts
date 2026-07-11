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

export const badRequest = (message: string): APIGatewayProxyResult => ({
    statusCode: 400,
    headers: corsHeaders(),
    body: JSON.stringify({ error: message }),
});

export const notFound = (message = 'Not found'): APIGatewayProxyResult => ({
    statusCode: 404,
    headers: corsHeaders(),
    body: JSON.stringify({ error: message }),
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

// Extract the verified email claim from the Cognito ID token.
export const getEmail = (event: { requestContext: { authorizer: unknown } }): string => {
    const authorizer = event.requestContext?.authorizer as { claims?: { email?: string } } | null;
    return authorizer?.claims?.email ?? '';
};

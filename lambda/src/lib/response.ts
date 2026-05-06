import { APIGatewayProxyResult } from 'aws-lambda';

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json',
};

export const ok = (body: unknown): APIGatewayProxyResult => ({
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify(body),
});

export const created = (body: unknown): APIGatewayProxyResult => ({
    statusCode: 201,
    headers: CORS,
    body: JSON.stringify(body),
});

export const noContent = (): APIGatewayProxyResult => ({
    statusCode: 204,
    headers: CORS,
    body: '',
});

export const badRequest = (message: string): APIGatewayProxyResult => ({
    statusCode: 400,
    headers: CORS,
    body: JSON.stringify({ error: message }),
});

export const notFound = (message = 'Not found'): APIGatewayProxyResult => ({
    statusCode: 404,
    headers: CORS,
    body: JSON.stringify({ error: message }),
});

export const serverError = (err: unknown): APIGatewayProxyResult => {
    console.error('Unhandled error:', err);
    return {
        statusCode: 500,
        headers: CORS,
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

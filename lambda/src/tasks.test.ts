import { APIGatewayProxyEvent } from 'aws-lambda';
import { GetCommand, QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// listTasks seeds :prefix into ExpressionAttributeValues but once referenced it only in
// the no-filter branch, and DynamoDB rejects an unreferenced binding — so every filtered
// task list 500'd. The mock does not emulate that validation; what these assert is that
// the built FilterExpression references :prefix on every path.

const send = vi.hoisted(() => vi.fn());

vi.mock('./lib/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./lib/db')>()),
    db: { send },
}));

// Static import is safe: vitest hoists the vi.mock above it.
import { handler } from './tasks';

const event = (queryStringParameters: Record<string, string> | null): APIGatewayProxyEvent => ({
    httpMethod: 'GET', pathParameters: null, queryStringParameters, headers: {},
    requestContext: { authorizer: { claims: { sub: 'u_1' } } },
} as unknown as APIGatewayProxyEvent);

/** The one QueryCommand listTasks sends. Fails loudly if a second is ever added. */
const queryInput = (): QueryCommandInput => {
    const calls = send.mock.calls.filter(([cmd]) => cmd instanceof QueryCommand);
    expect(calls).toHaveLength(1);
    return (calls[0][0] as QueryCommand).input;
};

beforeEach(() => {
    send.mockReset();
    // guardAccount reads the profile first; a missing profile is treated as ACTIVE.
    send.mockImplementation((cmd: unknown) =>
        Promise.resolve(cmd instanceof GetCommand ? {} : { Items: [] }));
});

describe('listTasks — FilterExpression references :prefix on every path', () => {
    it('no filters', async () => {
        expect((await handler(event(null))).statusCode).toBe(200);
        expect(queryInput().FilterExpression).toBe('begins_with(SK, :prefix)');
    });

    it('status=Pending', async () => {
        expect((await handler(event({ status: 'Pending' }))).statusCode).toBe(200);
        const filter = queryInput().FilterExpression;
        expect(filter).toContain('begins_with(SK, :prefix)');
        expect(filter).toContain('#status = :status'); // proves the filtered branch was taken
    });

    it('priority=High', async () => {
        expect((await handler(event({ priority: 'High' }))).statusCode).toBe(200);
        const filter = queryInput().FilterExpression;
        expect(filter).toContain('begins_with(SK, :prefix)');
        expect(filter).toContain('priority = :priority');
    });
});

// Second defect on the same path, masked by the one above until it was fixed: the Overdue
// branch put `dueDate < :now` in the FilterExpression, but dueDate is GSI2's sort key and
// DynamoDB rejects a key attribute there ("Filter Expression can only contain non-primary
// key attributes"). The mock cannot reproduce that validation either; these assert the
// predicate is in the KeyCondition and that :now did not become an orphaned binding.
describe('listTasks — status=Overdue bounds dueDate in the KeyCondition', () => {
    it('status=Overdue', async () => {
        expect((await handler(event({ status: 'Overdue' }))).statusCode).toBe(200);
        const input = queryInput();

        expect(input.KeyConditionExpression).toBe('PK = :pk AND dueDate < :now');
        expect(input.FilterExpression).not.toContain('dueDate');

        // :now must stay referenced — an unreferenced binding is the previous 500.
        expect(input.ExpressionAttributeValues).toHaveProperty(':now');
        expect(input.FilterExpression).toContain('begins_with(SK, :prefix)');
        expect(input.FilterExpression).toContain('#status <> :completed');
    });

    it('status=Overdue&priority=High keeps priority in the filter', async () => {
        expect((await handler(event({ status: 'Overdue', priority: 'High' }))).statusCode).toBe(200);
        const input = queryInput();

        expect(input.KeyConditionExpression).toBe('PK = :pk AND dueDate < :now');
        expect(input.FilterExpression).toContain('priority = :priority');
        expect(input.FilterExpression).not.toContain('dueDate');
    });

    // The other three paths must not have gained a sort-key bound.
    it.each([[null], [{ status: 'Pending' }], [{ priority: 'High' }], [{ status: 'Pending', priority: 'High' }]])(
        'non-Overdue path keeps KeyCondition unchanged: %j',
        async (params) => {
            expect((await handler(event(params))).statusCode).toBe(200);
            expect(queryInput().KeyConditionExpression).toBe('PK = :pk');
            expect(queryInput().ExpressionAttributeValues).not.toHaveProperty(':now');
        },
    );
});

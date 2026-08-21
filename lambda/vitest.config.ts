import { defineConfig } from 'vitest/config';

// Backend unit tests (D3). No AWS calls, no live table. Pure-function tests are the
// preferred shape — `lib/stock.ts` builds transaction items and returns them, so the
// part that is hardest to verify in production is testable here without mocking
// DynamoDB. A small number of handler tests may mock the DynamoDB client where the
// thing under test is query construction inside a handler and no pure function reaches
// it (see `tasks.test.ts`).
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});

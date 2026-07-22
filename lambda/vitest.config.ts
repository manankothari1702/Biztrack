import { defineConfig } from 'vitest/config';

// Backend unit tests (D3). Pure logic only — no AWS calls, no live table.
// `lib/stock.ts` builds transaction items and returns them, so the part that is
// hardest to verify in production is testable here without mocking DynamoDB.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});

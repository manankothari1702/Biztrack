module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // Resolve .ts BEFORE .js. `tsc` emits biztrack-stack.js next to the source
  // (gitignored build output), and Jest's default order puts js first — so
  // without this, tests silently assert against a stale compiled stack instead
  // of the source. cdk.json avoids the same trap via `ts-node --prefer-ts-exts`.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  setupFilesAfterEnv: ['aws-cdk-lib/testhelpers/jest-autoclean'],
};

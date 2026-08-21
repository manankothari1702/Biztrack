/**
 * GET /health — the health contract (`.ai-eos/platform/PLATFORM.md` §1).
 *
 * One endpoint, unauthenticated, never removed. It is how the fleet is
 * monitored by one thing.
 *
 * PATH: mounted at `/health`, not `/api/health`. The contract's path assumes an
 * app served behind a single origin with its API under `/api/`. Here the API is
 * its own origin (API Gateway) and every route sits at the root of the `prod`
 * stage, so `/api/health` would be the only inconsistent path in the whole API.
 * The contract's purpose is fully honoured. See `docs/PROJECT.md` §8 D-04.
 *
 * DETAIL IS AUTH-GATED. The unauthenticated body is `{"status": "..."}` and
 * nothing else — publishing versions and dependency state to the internet is
 * free reconnaissance. The richer body requires the monitoring token.
 *
 * It must stay cheap enough to poll every thirty seconds, and it never touches
 * a business table: the database probe is a DescribeTable control-plane call,
 * which reads no user data. `dynamodb:DescribeTable` is already granted by
 * `table.grantReadWriteData(lambdaRole)` — no new IAM was needed.
 */
import { APIGatewayProxyResult } from 'aws-lambda';
import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { TABLE } from './lib/db';
import { log } from './lib/log';

// Cold-start timestamp. In Lambda this is when THIS execution environment came
// up, not when the app was released — a fleet of warm containers will report
// different values. It is still the most useful "how long has this been up"
// signal available, so it is reported honestly rather than faked.
const STARTED_AT = new Date().toISOString();

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

// Anything slower than this and the database is "slow" rather than "ok" —
// a DescribeTable that takes half a second means something is wrong upstream.
const SLOW_MS = 500;

type DbStatus = 'ok' | 'slow' | 'down';

const probeDatabase = async (): Promise<{ database: DbStatus; ms: number }> => {
    const t0 = Date.now();
    try {
        const res = await ddb.send(new DescribeTableCommand({ TableName: TABLE }));
        const ms = Date.now() - t0;
        if (res.Table?.TableStatus !== 'ACTIVE') return { database: 'down', ms };
        return { database: ms > SLOW_MS ? 'slow' : 'ok', ms };
    } catch (err) {
        log.error('health.database_probe_failed', 'DescribeTable failed during health check', {
            error: err instanceof Error ? err.message : String(err),
        });
        return { database: 'down', ms: Date.now() - t0 };
    }
};

/**
 * True only when a monitoring token is configured AND the caller presents it.
 * With HEALTH_TOKEN unset (the default) detail is simply unavailable, which is
 * the safe failure direction — it can never leak by misconfiguration.
 */
const isTrustedCaller = (headers: Record<string, string | undefined> | null): boolean => {
    const expected = process.env.HEALTH_TOKEN;
    if (!expected) return false;
    const h = headers ?? {};
    const supplied = h['x-monitor-token'] ?? h['X-Monitor-Token'] ?? '';
    return supplied === expected;
};

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/** The whole status decision, in one place, with no I/O — so it is testable
 *  without mocking DynamoDB, exactly like `lib/stock.ts`. */
export const classify = (database: DbStatus): HealthStatus =>
    database === 'down' ? 'unhealthy'
  : database === 'slow' ? 'degraded'
  : 'healthy';

/** Builds the response body. Public callers get `{status}` and nothing else. */
export const buildBody = (
    database: DbStatus,
    trusted: boolean,
    checksMs: number,
): Record<string, unknown> => {
    const body: Record<string, unknown> = { status: classify(database) };
    if (!trusted) return body;

    body.app        = 'biztrack';
    body.version    = process.env.APP_VERSION ?? 'unknown';
    body.standard   = '3.0';
    body.database   = database;
    body.started_at = STARTED_AT;
    body.checks_ms  = checksMs;
    // `platform`, `restarts` and `last_backup_at` are deliberately absent
    // rather than faked. There is no platform component here (PROJECT.md §8
    // D-05); Lambda has no restart count; and backup is continuous DynamoDB
    // PITR, so "last backup" has no meaningful timestamp (§8 D-06).
    // Reporting `restarts: 0` would look like a fact.
    body.backup     = 'pitr-continuous';
    return body;
};

export const handler = async (event: {
    headers?: Record<string, string | undefined> | null;
}): Promise<APIGatewayProxyResult> => {
    const t0 = Date.now();
    const { database } = await probeDatabase();
    const body = buildBody(database, isTrustedCaller(event.headers ?? null), Date.now() - t0);

    return {
        statusCode: body.status === 'unhealthy' ? 503 : 200,
        headers: {
            'Content-Type':  'application/json',
            // Never let a CDN or browser serve a stale health answer.
            'Cache-Control': 'no-store',
        },
        body: JSON.stringify(body),
    };
};

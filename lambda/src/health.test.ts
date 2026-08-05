import { describe, expect, it } from 'vitest';
import { buildBody, classify } from './health';

// The health contract's two guarantees worth a test: the status mapping, and
// that an unauthenticated caller learns nothing beyond "is it alive".

describe('classify', () => {
    it('is healthy when the database answers promptly', () => {
        expect(classify('ok')).toBe('healthy');
    });

    it('is degraded — not unhealthy — when the database is merely slow', () => {
        // degraded is the state that saves you: it still serves traffic, so a
        // load balancer must not pull it out, but a human should look.
        expect(classify('slow')).toBe('degraded');
    });

    it('is unhealthy when the database is down', () => {
        expect(classify('down')).toBe('unhealthy');
    });
});

describe('buildBody — unauthenticated', () => {
    it('returns the status and NOTHING else', () => {
        // An unauthenticated endpoint publishing version and dependency state
        // is free reconnaissance for an attacker.
        expect(buildBody('ok', false, 12)).toEqual({ status: 'healthy' });
    });

    it('leaks nothing even when the app is unhealthy', () => {
        expect(buildBody('down', false, 12)).toEqual({ status: 'unhealthy' });
    });

    it('never includes version, database detail or timings', () => {
        const body = buildBody('slow', false, 999);
        for (const leaky of ['version', 'database', 'started_at', 'checks_ms', 'app', 'standard']) {
            expect(body).not.toHaveProperty(leaky);
        }
    });
});

describe('buildBody — trusted caller', () => {
    it('reports the machine-readable detail fleet monitoring needs', () => {
        const body = buildBody('ok', true, 12);
        expect(body.status).toBe('healthy');
        expect(body.app).toBe('biztrack');
        expect(body.database).toBe('ok');
        expect(body.checks_ms).toBe(12);
        expect(body.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('does not fake restarts or last_backup_at, which do not exist here', () => {
        const body = buildBody('ok', true, 12);
        expect(body).not.toHaveProperty('restarts');
        expect(body).not.toHaveProperty('last_backup_at');
        expect(body.backup).toBe('pitr-continuous');
    });
});

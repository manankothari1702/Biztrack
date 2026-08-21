/**
 * Structured JSON logging — the platform logging contract
 * (`.ai-eos/platform/PLATFORM.md` §3).
 *
 * Added ALONGSIDE existing logging, not as a replacement. Handlers already
 * using `console.error(...)` or `console.log(JSON.stringify(...))` keep
 * working exactly as they did; adoption is opportunistic — use this in new
 * code, and when you are editing a log line anyway.
 *
 * Every line carries `ts`, `level`, `app`, `event`, `msg`. `event` is a stable
 * dotted name, never prose: prose changes, `invoice.finalized` stays greppable
 * for five years.
 *
 * Never pass a password, token, full client record or complete request body.
 * `verify.sh` greps for the obvious cases.
 */

type Level = 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';

const APP = 'biztrack';

/** Context worth attaching whenever it exists — an error you cannot attribute
 *  to a user and a record costs an hour of guessing. */
export interface LogContext {
    uid?: string;
    record_id?: string;
    [key: string]: unknown;
}

const emit = (level: Level, event: string, msg: string, ctx: LogContext = {}): void => {
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        app: APP,
        event,
        msg,
        ...ctx,
    });
    // WARNING and above go to stderr so CloudWatch metric filters and local
    // runs can separate them without parsing.
    if (level === 'ERROR' || level === 'WARNING') console.error(line);
    else console.log(line);
};

export const log = {
    error:   (event: string, msg: string, ctx?: LogContext) => emit('ERROR', event, msg, ctx),
    warning: (event: string, msg: string, ctx?: LogContext) => emit('WARNING', event, msg, ctx),
    info:    (event: string, msg: string, ctx?: LogContext) => emit('INFO', event, msg, ctx),
    /** Development only. Off in production unless LOG_DEBUG is set. */
    debug:   (event: string, msg: string, ctx?: LogContext) => {
        if (process.env.LOG_DEBUG === '1') emit('DEBUG', event, msg, ctx);
    },
};

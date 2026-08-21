import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAX_PAGES, collectAllPages, type Page } from './pagination';

/** A fake endpoint that hands back `pages` in order, recording the tokens it saw. */
const fakeApi = (pages: Page<string>[]) => {
    const seen: (string | null)[] = [];
    let call = 0;
    return {
        seen,
        fetchPage: async (nextToken: string | null): Promise<Page<string>> => {
            seen.push(nextToken);
            return pages[Math.min(call++, pages.length - 1)];
        },
        get calls() { return call; },
    };
};

describe('collectAllPages', () => {
    it('returns a single page unchanged', async () => {
        const api = fakeApi([{ items: ['a', 'b'], nextToken: null }]);
        expect(await collectAllPages(api.fetchPage)).toEqual(['a', 'b']);
        expect(api.calls).toBe(1);
    });

    it('concatenates every page in order', async () => {
        const api = fakeApi([
            { items: ['a', 'b'], nextToken: 't1' },
            { items: ['c'],      nextToken: 't2' },
            { items: ['d', 'e'], nextToken: null },
        ]);
        expect(await collectAllPages(api.fetchPage)).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(api.calls).toBe(3);
    });

    it('passes null first, then each server token back in', async () => {
        const api = fakeApi([
            { items: ['a'], nextToken: 't1' },
            { items: ['b'], nextToken: 't2' },
            { items: ['c'], nextToken: null },
        ]);
        await collectAllPages(api.fetchPage);
        expect(api.seen).toEqual([null, 't1', 't2']);
    });

    it('handles an empty first page', async () => {
        const api = fakeApi([{ items: [], nextToken: null }]);
        expect(await collectAllPages(api.fetchPage)).toEqual([]);
    });

    it('keeps walking past an empty intermediate page', async () => {
        // DynamoDB can return zero items with a token when a filter excluded
        // everything on that page — stopping there would silently truncate.
        const api = fakeApi([
            { items: [],    nextToken: 't1' },
            { items: ['a'], nextToken: null },
        ]);
        expect(await collectAllPages(api.fetchPage)).toEqual(['a']);
        expect(api.calls).toBe(2);
    });

    it('stops when the server repeats a token, instead of looping forever', async () => {
        const fetchPage = vi.fn(async (): Promise<Page<string>> => ({ items: ['x'], nextToken: 'same' }));
        const out = await collectAllPages(fetchPage);
        // First page yields 'same'; the second sees it again and stops.
        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(out).toEqual(['x', 'x']);
    });

    it('stops at maxPages when tokens never repeat', async () => {
        let n = 0;
        const fetchPage = async (): Promise<Page<string>> => ({ items: ['x'], nextToken: `t${n++}` });
        const out = await collectAllPages(fetchPage, { maxPages: 5 });
        expect(out).toHaveLength(5);
    });

    it('defaults to a bounded page count', async () => {
        expect(DEFAULT_MAX_PAGES).toBeGreaterThan(0);
        let n = 0;
        const fetchPage = async (): Promise<Page<string>> => ({ items: ['x'], nextToken: `t${n++}` });
        expect(await collectAllPages(fetchPage)).toHaveLength(DEFAULT_MAX_PAGES);
    });

    it('aborts between pages when shouldContinue turns false', async () => {
        let current = true;
        const api = fakeApi([
            { items: ['a'], nextToken: 't1' },
            { items: ['b'], nextToken: 't2' },
            { items: ['c'], nextToken: null },
        ]);
        const fetchPage = async (t: string | null) => {
            const page = await api.fetchPage(t);
            current = false;   // a newer request started while page 1 was in flight
            return page;
        };
        // Partial results come back rather than being thrown away; the caller's
        // version guard decides whether to use them.
        expect(await collectAllPages(fetchPage, { shouldContinue: () => current })).toEqual(['a']);
    });

    it('does not call the endpoint at all if aborted before the first page', async () => {
        const fetchPage = vi.fn(async (): Promise<Page<string>> => ({ items: ['a'], nextToken: null }));
        expect(await collectAllPages(fetchPage, { shouldContinue: () => false })).toEqual([]);
        expect(fetchPage).not.toHaveBeenCalled();
    });

    it('propagates a rejection rather than swallowing it', async () => {
        const fetchPage = async (): Promise<Page<string>> => { throw new Error('network'); };
        await expect(collectAllPages(fetchPage)).rejects.toThrow('network');
    });
});

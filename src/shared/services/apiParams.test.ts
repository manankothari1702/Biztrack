import { describe, expect, it } from 'vitest';
import {
    EMPTY_INVENTORY_FILTERS,
    batchParams,
    productParams,
    stockMovementParams,
    suffix,
    toBatchFilters,
    toProductFilters,
} from './apiParams';

const qs = (p: URLSearchParams) => p.toString();

describe('productParams', () => {
    it('sends nothing when there is nothing to filter', () => {
        expect(qs(productParams())).toBe('');
        expect(qs(productParams({}))).toBe('');
    });

    it('maps every supported field', () => {
        expect(qs(productParams({
            search: 'formula', category: 'Energy', stockStatus: 'Low Stock',
            expiringInDays: 30, status: 'expired', sortBy: 'value',
            limit: 50, nextToken: 'abc',
        }))).toBe(
            'search=formula&category=Energy&stockStatus=Low+Stock&expiringInDays=30'
            + '&status=expired&sortBy=value&limit=50&nextToken=abc',
        );
    });

    it("drops the UI's 'All' sentinel, which the server would match literally", () => {
        expect(qs(productParams({ category: 'All', stockStatus: 'All' }))).toBe('');
        expect(qs(productParams({ category: 'Energy', stockStatus: 'All' }))).toBe('category=Energy');
    });

    it('encodes a space as + — which API Gateway decodes back to a space', () => {
        expect(qs(productParams({ category: 'Weight Management' }))).toBe('category=Weight+Management');
    });

    it('keeps expiringInDays=0 (today only), which a truthiness check would drop', () => {
        expect(qs(productParams({ expiringInDays: 0 }))).toBe('expiringInDays=0');
    });

    it('omits an empty search rather than sending search=', () => {
        expect(qs(productParams({ search: '' }))).toBe('');
    });

    it('escapes a search term with URL-significant characters', () => {
        expect(qs(productParams({ search: 'a&b=c d' }))).toBe('search=a%26b%3Dc+d');
    });
});

describe('batchParams', () => {
    it('is empty by default', () => {
        expect(qs(batchParams())).toBe('');
    });

    it('maps every supported field', () => {
        expect(qs(batchParams({
            expiringInDays: 30, status: 'expired', productId: 'p_1', limit: 200, nextToken: 'tok',
        }))).toBe('expiringInDays=30&status=expired&productId=p_1&limit=200&nextToken=tok');
    });

    it('keeps expiringInDays=0', () => {
        expect(qs(batchParams({ expiringInDays: 0 }))).toBe('expiringInDays=0');
    });

    it('sends includeEmpty only when true — false is the server default', () => {
        expect(qs(batchParams({ includeEmpty: true }))).toBe('includeEmpty=true');
        expect(qs(batchParams({ includeEmpty: false }))).toBe('');
        expect(qs(batchParams({}))).toBe('');
    });

    it('combines includeEmpty with an expiry window', () => {
        expect(qs(batchParams({ expiringInDays: 30, includeEmpty: true })))
            .toBe('expiringInDays=30&includeEmpty=true');
    });
});

describe('stockMovementParams', () => {
    it('is empty by default', () => {
        expect(qs(stockMovementParams())).toBe('');
    });

    it('maps every supported field', () => {
        expect(qs(stockMovementParams({
            productId: 'p_1', type: 'WRITE_OFF',
            from: '2026-07-01', to: '2026-07-31', limit: 50, nextToken: 'tok',
        }))).toBe('productId=p_1&type=WRITE_OFF&from=2026-07-01&to=2026-07-31&limit=50&nextToken=tok');
    });

    it('escapes a full ISO timestamp', () => {
        expect(qs(stockMovementParams({ from: '2026-07-22T10:00:00.000Z' })))
            .toBe('from=2026-07-22T10%3A00%3A00.000Z');
    });
});

describe('suffix', () => {
    it('prefixes ? only when there is something to send', () => {
        expect(suffix(new URLSearchParams())).toBe('');
        expect(suffix(productParams({ search: 'x' }))).toBe('?search=x');
    });
});

describe('toProductFilters — filter bar to request', () => {
    it('sends nothing for the default state', () => {
        expect(toProductFilters(EMPTY_INVENTORY_FILTERS)).toEqual({ sortBy: 'name' });
        expect(qs(productParams(toProductFilters(EMPTY_INVENTORY_FILTERS)))).toBe('sortBy=name');
    });

    it('maps the expiry dropdown onto TWO different server params', () => {
        // expiringInDays cannot express "already past", so 'expired' must become
        // `status` — the single most likely place for this mapping to go wrong.
        expect(toProductFilters({ expiry: 'expiring' }, 30)).toEqual({ expiringInDays: 30 });
        expect(toProductFilters({ expiry: 'expired' })).toEqual({ status: 'expired' });
        expect(toProductFilters({ expiry: 'All' })).toEqual({});
    });

    it('honours a custom soonDays window', () => {
        expect(toProductFilters({ expiry: 'expiring' }, 7)).toEqual({ expiringInDays: 7 });
    });

    it('never sets both expiry params at once', () => {
        for (const expiry of ['All', 'expiring', 'expired']) {
            const f = toProductFilters({ expiry });
            expect(f.expiringInDays !== undefined && f.status !== undefined).toBe(false);
        }
    });

    it('trims the search box and drops it when blank', () => {
        expect(toProductFilters({ search: '  formula  ' })).toEqual({ search: 'formula' });
        expect(toProductFilters({ search: '   ' })).toEqual({});
    });

    it('drops the All sentinels', () => {
        expect(toProductFilters({ category: 'All', stockStatus: 'All' })).toEqual({});
    });

    it('passes real selections through', () => {
        expect(toProductFilters({
            search: 'shake', category: 'Weight Management',
            stockStatus: 'Low Stock', expiry: 'expiring', sortBy: 'value',
        }, 30)).toEqual({
            search: 'shake', category: 'Weight Management',
            stockStatus: 'Low Stock', expiringInDays: 30, sortBy: 'value',
        });
    });

    it('tolerates a partial state object', () => {
        expect(toProductFilters()).toEqual({});
        expect(toProductFilters({})).toEqual({});
    });
});

describe('toBatchFilters', () => {
    it('carries only the expiry window — batches have no search or category', () => {
        expect(toBatchFilters({ expiry: 'expiring' }, 30)).toEqual({ expiringInDays: 30 });
        expect(toBatchFilters({ expiry: 'expired' })).toEqual({ status: 'expired' });
        expect(toBatchFilters({ expiry: 'All', search: 'shake', category: 'Energy' })).toEqual({});
    });
});

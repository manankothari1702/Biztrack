/**
 * DynamoDB pagination helper.
 *
 * Every list endpoint returns one page plus a `nextToken`; a caller that wants a
 * true total (or a fully sorted list) has to walk them all, because DynamoDB's
 * `Count` is per-page and its sort is per-page too. `useClients` does this
 * inline; this is the same loop, extracted so it can be tested without React.
 */

export interface Page<T> {
    items: T[];
    nextToken: string | null;
}

export interface CollectOptions {
    /**
     * Hard ceiling on pages walked. Guards against a server that keeps handing
     * back a token — an unbounded `do…while` driven by remote data would hang
     * the UI with no way out. Generous enough that real catalogues never hit it.
     */
    maxPages?: number;
    /** Abort between pages — lets a stale request stop paging early. */
    shouldContinue?: () => boolean;
}

export const DEFAULT_MAX_PAGES = 100;

/**
 * Walk every page and return the accumulated items.
 *
 * `fetchPage` receives the token for the page it should fetch (`null` for the
 * first) and returns that page's items plus the token that follows.
 *
 * Stops when: the server reports no further token, `maxPages` is reached, the
 * same token comes back twice (a server-side loop), or `shouldContinue` turns
 * false. Partial results are returned rather than thrown away — a caller that
 * aborted mid-walk gets what it had, and the version guard decides whether to
 * use it.
 */
export const collectAllPages = async <T>(
    fetchPage: (nextToken: string | null) => Promise<Page<T>>,
    options: CollectOptions = {},
): Promise<T[]> => {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const shouldContinue = options.shouldContinue ?? (() => true);

    const accumulated: T[] = [];
    const seenTokens = new Set<string>();
    let token: string | null = null;
    let pages = 0;

    do {
        if (!shouldContinue()) break;

        const page = await fetchPage(token);
        accumulated.push(...page.items);
        pages++;

        token = page.nextToken;

        // A token we have already followed means the server is cycling; stop
        // rather than fetch the same page forever.
        if (token !== null) {
            if (seenTokens.has(token)) break;
            seenTokens.add(token);
        }
    } while (token !== null && pages < maxPages);

    return accumulated;
};

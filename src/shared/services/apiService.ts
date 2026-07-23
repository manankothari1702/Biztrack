import { fetchAuthSession } from 'aws-amplify/auth';
import { API_URL } from '../lib/aws';
import type {
    Client, Task, FlatOrgNode, User, AccountDeletionResponse,
    Product, Batch, StockMovement, MovementType, WriteOffReason,
} from '../types';

export const PENDING_DELETION_EVENT = 'biztrack:account-pending-deletion';

export interface PendingDeletionDetail {
    message: string;
    purgeAt: string | null;
}

// ── Auth token ──────────────────────────────────────────────────────────────

const getToken = async (): Promise<string> => {
    const session = await fetchAuthSession();
    const token   = session.tokens?.idToken?.toString();
    if (!token) throw new Error('Not authenticated');
    return token;
};

// ── Typed API error (carries HTTP status) ───────────────────────────────────

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        public readonly code?: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

// ── Base fetch wrapper ──────────────────────────────────────────────────────

const request = async <T>(
    path: string,
    options: RequestInit = {}
): Promise<T> => {
    const token = await getToken();
    const url   = `${API_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type':  'application/json',
            'Authorization': token,
            ...options.headers,
        },
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText })) as {
            error?: string;
            message?: string;
            purgeAt?: string | null;
        };
        const code = body.error;
        const message = body.message ?? body.error ?? `Request failed: ${res.status}`;

        // Account-pending-deletion: surface to the auth layer so it can sign the
        // user out and show the support message. Every protected endpoint can
        // return this, so detection lives here.
        if (res.status === 403 && code === 'ACCOUNT_PENDING_DELETION') {
            const detail: PendingDeletionDetail = {
                message,
                purgeAt: body.purgeAt ?? null,
            };
            window.dispatchEvent(new CustomEvent<PendingDeletionDetail>(PENDING_DELETION_EVENT, { detail }));
        }

        throw new ApiError(res.status, message, code);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
};

// ── Clients ─────────────────────────────────────────────────────────────────

export interface ClientsResponse {
    clients: Client[];
    nextToken: string | null;
    count: number;
}

export interface ClientFilters {
    clientType?: string;
    search?: string;
    sortBy?: string;
    limit?: number;
    nextToken?: string;
    // Due/calendar range mode (audit B1): GSI1-scoped nextFollowUpDate queries.
    dueBefore?: string; // ISO upper bound (inclusive)
    dueFrom?: string;   // ISO lower bound (inclusive)
    status?: string;    // e.g. 'Active'
}

export const clientsApi = {
    list: (filters: ClientFilters = {}): Promise<ClientsResponse> => {
        const params = new URLSearchParams();
        if (filters.clientType && filters.clientType !== 'All') params.set('clientType', filters.clientType);
        if (filters.search)    params.set('search',  filters.search);
        if (filters.sortBy)    params.set('sortBy',  filters.sortBy);
        if (filters.limit)     params.set('limit',   String(filters.limit));
        if (filters.nextToken) params.set('nextToken', filters.nextToken);
        if (filters.dueBefore) params.set('dueBefore', filters.dueBefore);
        if (filters.dueFrom)   params.set('dueFrom',  filters.dueFrom);
        if (filters.status)    params.set('status',   filters.status);
        const qs = params.toString();
        return request<ClientsResponse>(`clients${qs ? `?${qs}` : ''}`);
    },

    get: (id: string): Promise<Client> =>
        request<Client>(`clients/${id}`),

    add: (client: Client): Promise<Client> =>
        request<Client>('clients', { method: 'POST', body: JSON.stringify(client) }),

    update: (client: Client): Promise<Client> =>
        request<Client>(`clients/${client.id}`, { method: 'PUT', body: JSON.stringify(client) }),

    delete: (id: string): Promise<void> =>
        request<void>(`clients/${id}`, { method: 'DELETE' }),

    // imported = rows that ACTUALLY persisted (after UnprocessedItems retries + wall-clock
    // guard). failed = requested − imported; timedOut = stopped early on the deadline.
    bulkAdd: (clients: Client[]): Promise<{ imported: number; requested: number; failed: number; timedOut: boolean }> =>
        request<{ imported: number; requested: number; failed: number; timedOut: boolean }>(
            'clients/bulk', { method: 'POST', body: JSON.stringify({ clients }) }),

    bulkDelete: (ids: string[]): Promise<{ deleted: number; requested: number; timedOut: boolean }> =>
        request<{ deleted: number; requested: number; timedOut: boolean }>(
            'clients/bulk', { method: 'DELETE', body: JSON.stringify({ ids }) }),
};

// ── Tasks ────────────────────────────────────────────────────────────────────

export interface TasksResponse {
    tasks: Task[];
    nextToken: string | null;
}

export interface TaskFilters {
    status?: string;
    priority?: string;
    limit?: number;
    nextToken?: string;
    // Calendar range mode (audit B1): GSI2-scoped dueDate queries.
    from?: string;              // ISO lower bound (inclusive)
    to?: string;                // ISO upper bound (inclusive)
    excludeCompleted?: string;  // '1' to omit Completed tasks
}

export const tasksApi = {
    list: (filters: TaskFilters = {}): Promise<TasksResponse> => {
        const params = new URLSearchParams();
        if (filters.status)    params.set('status',   filters.status);
        if (filters.priority)  params.set('priority', filters.priority);
        if (filters.limit)     params.set('limit',    String(filters.limit));
        if (filters.nextToken) params.set('nextToken', filters.nextToken);
        if (filters.from)      params.set('from', filters.from);
        if (filters.to)        params.set('to',   filters.to);
        if (filters.excludeCompleted) params.set('excludeCompleted', filters.excludeCompleted);
        const qs = params.toString();
        return request<TasksResponse>(`tasks${qs ? `?${qs}` : ''}`);
    },

    get: (id: string): Promise<Task> =>
        request<Task>(`tasks/${id}`),

    add: (task: Task): Promise<Task> =>
        request<Task>('tasks', { method: 'POST', body: JSON.stringify(task) }),

    update: (task: Task): Promise<Task> =>
        request<Task>(`tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(task) }),

    delete: (id: string): Promise<void> =>
        request<void>(`tasks/${id}`, { method: 'DELETE' }),
};

// ── Products ─────────────────────────────────────────────────────────────────

export interface ProductsResponse {
    products: Product[];
    nextToken: string | null;
    count: number;
}

export interface ProductFilters {
    search?: string;
    category?: string;
    /** 'In Stock' | 'Low Stock' | 'Out of Stock' — derived server-side from totalQuantity vs reorderLevel. */
    stockStatus?: string;
    /** Products whose cached earliestExpiry falls in today … today+N. */
    expiringInDays?: number;
    /**
     * `'expired'` — earliestExpiry < today. Distinct from expiringInDays, which
     * cannot express the past; this is what the dashboard's Expired card links to.
     */
    status?: 'expired';
    /** 'name' | 'stockNo' | 'quantity' | 'value' | 'expiry'. Orders the returned page. */
    sortBy?: string;
    limit?: number;
    nextToken?: string;
}

export interface BatchesResponse {
    batches: Batch[];
    nextToken: string | null;
}

/** Rows that actually persisted, not rows attempted — see the bulk contract. */
export interface BulkProductsResult {
    imported: number;   // created
    updated: number;    // matched an existing stockNo
    requested: number;
    failed: number;
    timedOut: boolean;
}

export const productsApi = {
    list: (filters: ProductFilters = {}): Promise<ProductsResponse> => {
        const params = new URLSearchParams();
        if (filters.search)         params.set('search', filters.search);
        if (filters.category && filters.category !== 'All') params.set('category', filters.category);
        if (filters.stockStatus && filters.stockStatus !== 'All') params.set('stockStatus', filters.stockStatus);
        if (filters.expiringInDays !== undefined) params.set('expiringInDays', String(filters.expiringInDays));
        if (filters.status)         params.set('status', filters.status);
        if (filters.sortBy)         params.set('sortBy', filters.sortBy);
        if (filters.limit)          params.set('limit', String(filters.limit));
        if (filters.nextToken)      params.set('nextToken', filters.nextToken);
        const qs = params.toString();
        return request<ProductsResponse>(`products${qs ? `?${qs}` : ''}`);
    },

    get: (id: string): Promise<Product> =>
        request<Product>(`products/${encodeURIComponent(id)}`),

    add: (product: Product): Promise<Product> =>
        request<Product>('products', { method: 'POST', body: JSON.stringify(product) }),

    // Catalogue fields only. totalQuantity / earliestExpiry / invDate are dropped
    // server-side and restored from the stored row — a rename can never move stock.
    update: (product: Product): Promise<Product> =>
        request<Product>(`products/${encodeURIComponent(product.id)}`, {
            method: 'PUT', body: JSON.stringify(product),
        }),

    delete: (id: string): Promise<void> =>
        request<void>(`products/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    // Upsert matched on a normalized stockNo. Never touches batches or stock.
    // Two rows normalizing to one stockNo are rejected with 400 VALIDATION + row index.
    bulkAdd: (products: Product[]): Promise<BulkProductsResult> =>
        request<BulkProductsResult>('products/bulk', {
            method: 'POST', body: JSON.stringify({ products }),
        }),

    bulkDelete: (ids: string[]): Promise<{ deleted: number; requested: number; timedOut: boolean }> =>
        request<{ deleted: number; requested: number; timedOut: boolean }>('products/bulk', {
            method: 'DELETE', body: JSON.stringify({ ids }),
        }),

    /** One product's batches — the sale batch picker's source. Empty batches hidden by default. */
    batches: (id: string, includeEmpty = false): Promise<BatchesResponse> => {
        const params = new URLSearchParams();
        if (includeEmpty) params.set('includeEmpty', 'true');
        const qs = params.toString();
        return request<BatchesResponse>(`products/${encodeURIComponent(id)}/batches${qs ? `?${qs}` : ''}`);
    },
};

// ── Batches ──────────────────────────────────────────────────────────────────

export interface BatchFilters {
    /** Expiring in today … today+N, over GSI6-InventoryDate. */
    expiringInDays?: number;
    /** `'expired'` — invDate < today. */
    status?: 'expired';
    productId?: string;
    limit?: number;
    nextToken?: string;
}

export interface AdjustBatchBody {
    /** ABSOLUTE on-hand count — the server derives the delta. */
    quantity: number;
    /** Changing this re-keys the batch: the stock moves rows, merging if the target exists. */
    expiryDate?: string;
    note?: string;
}

export interface WriteOffResult {
    batch: Batch;
    writtenOff: number;
}

// Path params are encoded because these routes carry TWO dynamic segments; an
// unencoded value containing a slash would silently re-route the request.
const batchPath = (productId: string, expiry: string): string =>
    `batches/${encodeURIComponent(productId)}/${encodeURIComponent(expiry)}`;

export const batchesApi = {
    list: (filters: BatchFilters = {}): Promise<BatchesResponse> => {
        const params = new URLSearchParams();
        if (filters.expiringInDays !== undefined) params.set('expiringInDays', String(filters.expiringInDays));
        if (filters.status)    params.set('status', filters.status);
        if (filters.productId) params.set('productId', filters.productId);
        if (filters.limit)     params.set('limit', String(filters.limit));
        if (filters.nextToken) params.set('nextToken', filters.nextToken);
        const qs = params.toString();
        return request<BatchesResponse>(`batches${qs ? `?${qs}` : ''}`);
    },

    expiring: (days = 30): Promise<BatchesResponse> =>
        batchesApi.list({ expiringInDays: days }),

    expired: (): Promise<BatchesResponse> =>
        batchesApi.list({ status: 'expired' }),

    /** Manual correction. Writes an ADJUST movement; may re-key. 409 if the batch moved in flight. */
    adjust: (productId: string, expiry: string, body: AdjustBatchBody): Promise<Batch> =>
        request<Batch>(batchPath(productId, expiry), { method: 'PUT', body: JSON.stringify(body) }),

    /** Zeroes the batch and writes a WRITE_OFF movement. 409 BATCH_EMPTY if already zero. */
    writeOff: (
        productId: string,
        expiry: string,
        reason: WriteOffReason,
        note?: string,
    ): Promise<WriteOffResult> =>
        request<WriteOffResult>(`${batchPath(productId, expiry)}/write-off`, {
            method: 'POST', body: JSON.stringify({ reason, note }),
        }),
};

// ── Stock movements (read-only audit) ────────────────────────────────────────
//
// There is no create/update/delete. Movements are written server-side, inside
// the transaction that moves the batch and the product roll-up.

export interface StockMovementsResponse {
    movements: StockMovement[];
    nextToken: string | null;
}

export interface StockMovementFilters {
    productId?: string;
    type?: MovementType;
    /** Date (`2026-07-22`) or full timestamp; a bare date covers that whole day. */
    from?: string;
    to?: string;
    limit?: number;
    nextToken?: string;
}

export const stockApi = {
    list: (filters: StockMovementFilters = {}): Promise<StockMovementsResponse> => {
        const params = new URLSearchParams();
        if (filters.productId) params.set('productId', filters.productId);
        if (filters.type)      params.set('type', filters.type);
        if (filters.from)      params.set('from', filters.from);
        if (filters.to)        params.set('to', filters.to);
        if (filters.limit)     params.set('limit', String(filters.limit));
        if (filters.nextToken) params.set('nextToken', filters.nextToken);
        const qs = params.toString();
        return request<StockMovementsResponse>(`stock-movements${qs ? `?${qs}` : ''}`);
    },
};

// ── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardResponse {
    counts: {
        dueCalls: number;
        totalClients: number;
        pendingTasks: number;
        overdueTasks: number;
        completedTasks: number;
    };
    dueClients: Client[];
    upcomingFollowUps: Client[];
    priorityTasks: Task[];
    recentClients: Client[];
    recentContacts: Client[];
}

export const dashboardApi = {
    get: (): Promise<DashboardResponse> => request<DashboardResponse>('dashboard'),
};

// ── User / Profile ───────────────────────────────────────────────────────────

export const userApi = {
    getProfile: (): Promise<User> =>
        request<User>('user'),

    updateProfile: (user: User): Promise<User> =>
        request<User>('user', { method: 'PUT', body: JSON.stringify(user) }),

    getOrgNodes: (): Promise<{ orgNodes: FlatOrgNode[] }> =>
        request<{ orgNodes: FlatOrgNode[] }>('user/org'),

    addOrgNode: (node: FlatOrgNode): Promise<FlatOrgNode> =>
        request<FlatOrgNode>('user/org', { method: 'POST', body: JSON.stringify(node) }),

    updateOrgNode: (node: FlatOrgNode): Promise<FlatOrgNode> =>
        request<FlatOrgNode>(`user/org/${node.id}`, { method: 'PUT', body: JSON.stringify(node) }),

    // Server deletes the whole subtree (audit B3) and returns the ids it actually removed.
    deleteOrgNode: (nodeId: string): Promise<{ deletedIds: string[]; requested: number; partial: boolean }> =>
        request<{ deletedIds: string[]; requested: number; partial: boolean }>(`user/org/${nodeId}`, { method: 'DELETE' }),

    // Initiates soft-delete: backend flips accountStatus to PENDING_DELETION,
    // sets deletedAt/purgeAt (7 days out), and revokes Cognito refresh tokens.
    deleteAccount: (): Promise<AccountDeletionResponse> =>
        request<AccountDeletionResponse>('user', { method: 'DELETE' }),
};

// ── WhatsApp ─────────────────────────────────────────────────────────────────

export const whatsappApi = {
    sendTest: (): Promise<{ success: boolean; sentTo: string }> =>
        request<{ success: boolean; sentTo: string }>('whatsapp/test', { method: 'POST' }),
};
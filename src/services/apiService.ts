import { fetchAuthSession } from 'aws-amplify/auth';
import { API_URL } from '../lib/aws';
import type { Client, Task, FlatOrgNode, User } from '../types';

// ── Auth token ──────────────────────────────────────────────────────────────

const getToken = async (): Promise<string> => {
    const session = await fetchAuthSession();
    const token   = session.tokens?.idToken?.toString();
    if (!token) throw new Error('Not authenticated');
    return token;
};

// ── Typed API error (carries HTTP status) ───────────────────────────────────

export class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
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
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`);
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
}

export const clientsApi = {
    list: (filters: ClientFilters = {}): Promise<ClientsResponse> => {
        const params = new URLSearchParams();
        if (filters.clientType && filters.clientType !== 'All') params.set('clientType', filters.clientType);
        if (filters.search)    params.set('search',  filters.search);
        if (filters.sortBy)    params.set('sortBy',  filters.sortBy);
        if (filters.limit)     params.set('limit',   String(filters.limit));
        if (filters.nextToken) params.set('nextToken', filters.nextToken);
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

    bulkAdd: (clients: Client[]): Promise<{ imported: number }> =>
        request<{ imported: number }>('clients/bulk', { method: 'POST', body: JSON.stringify({ clients }) }),

    bulkDelete: (ids: string[]): Promise<{ deleted: number }> =>
        request<{ deleted: number }>('clients/bulk', { method: 'DELETE', body: JSON.stringify({ ids }) }),
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
}

export const tasksApi = {
    list: (filters: TaskFilters = {}): Promise<TasksResponse> => {
        const params = new URLSearchParams();
        if (filters.status)    params.set('status',   filters.status);
        if (filters.priority)  params.set('priority', filters.priority);
        if (filters.limit)     params.set('limit',    String(filters.limit));
        if (filters.nextToken) params.set('nextToken', filters.nextToken);
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

    deleteOrgNode: (nodeId: string): Promise<void> =>
        request<void>(`user/org/${nodeId}`, { method: 'DELETE' }),
};

// ── WhatsApp ─────────────────────────────────────────────────────────────────

export const whatsappApi = {
    sendTest: (): Promise<{ success: boolean; sentTo: string }> =>
        request<{ success: boolean; sentTo: string }>('whatsapp/test', { method: 'POST' }),
};

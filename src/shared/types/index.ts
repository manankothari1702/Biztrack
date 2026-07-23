export type Priority = 'High' | 'Medium' | 'Low';
export type TaskStatus = 'Pending' | 'In Progress' | 'Completed';
export type ClientType = 'Prospect' | 'User' | 'Associate' | 'Supervisor';
export type ClientStatus = 'Active' | 'Archived' | 'Converted';

export enum OrgLevel {
  Root = 'Root',
  Supervisor = 'Supervisor',
  WorldTeam = 'World Team',
  ActiveWorldTeam = 'Active World Team',
  GET = 'GET',
  GET2500 = 'GET 2500',
  Millionaire = 'Millionaire Team',
  Mill7500 = 'Mill 7500',
  President = 'President Team',
  Chairman = 'Chairman Club',
  Founder = 'Founder Circle',
}

export type AccountStatus = 'ACTIVE' | 'PENDING_DELETION';

export interface User {
  name: string;
  email: string;
  level: OrgLevel;
  phoneNumber?: string;
  countryCode?: string;
  reportGenerationTime?: string;  // HH:MM in user's local timezone
  reportEnabled?: boolean;
  timezone?: string;              // IANA tz string e.g. "Asia/Kolkata"
  lastReportSentAt?: string;      // ISO string
  lastReportStatus?: 'delivered' | 'failed';
  photoURL?: string;
  avatarColor?: string;
  createdAt?: string;       // ISO string — set by PostConfirmation Lambda or auto-provision
  // Soft-delete state. Managed exclusively by the backend; never set via PUT /user.
  accountStatus?: AccountStatus;
  deletedAt?: string | null;
  purgeAt?: string | null;
}

export interface AccountDeletionResponse {
  accountStatus: 'PENDING_DELETION';
  deletedAt: string;
  purgeAt: string;
}

export interface Task {
  id: string;
  title: string;
  priority: Priority;
  status: TaskStatus;
  dueDate: string; // ISO Date string
  notes: string;
}

export interface Client {
  id: string;
  clientName: string;
  clientNameLower?: string; // Normalized for search
  mobileDigits?: string;    // Normalized digits (no spaces/dashes)
  mobileReverse?: string;   // Reversed digits (for suffix search)
  profileImage?: string; // New
  company?: string;
  mobile: string;
  phoneNumber?: string; // Local part
  country?: string; // Country name
  countryCode: string; // Prefix
  email: string;
  clientType: ClientType;
  frequency: 'Daily' | 'Weekly' | 'Bi-Weekly' | 'Monthly';
  lastContactDate?: string; // ISO Date string
  nextFollowUpDate: string; // ISO Date string
  notes: string;
  status: ClientStatus;
  createdAt: string; // New ISO Date string
}

// Flat shape stored in DynamoDB — no children array
export interface FlatOrgNode {
  id: string;
  name: string;
  role: string;
  level: OrgLevel;
  parentId: string | null;
}

// In-memory tree shape built by buildOrgTree — never persisted directly
export interface OrgNode extends FlatOrgNode {
  children: OrgNode[];
}

// ── Date conventions ────────────────────────────────────────────────────────
// Two distinct string shapes live in this app. They are NOT interchangeable.

/**
 * Date-only ISO string: `YYYY-MM-DD`. No time, no timezone.
 *
 * Expiries are calendar dates — a batch expires on a day, not at an instant.
 * Lexicographic order equals chronological order, so compare these as strings
 * (`a < b`), never by converting to `Date`.
 *
 * NEVER pass an IsoDate through `new Date().toISOString()`: that reinterprets
 * it as UTC midnight and can shift the calendar day for any user east or west
 * of UTC (including Asia/Kolkata, +05:30).
 */
export type IsoDate = string;

/**
 * Full ISO 8601 timestamp, e.g. `2026-07-22T10:00:00.000Z` — the existing
 * convention for `createdAt` / `updatedAt` / `nextFollowUpDate`.
 */
export type IsoTimestamp = string;

// ── Inventory ───────────────────────────────────────────────────────────────

/**
 * The 15 categories present in `docs/inventory/herbalife_products_seed.csv`,
 * plus `Other`. The catalogue is the source of truth — see PRD §7.
 */
export type ProductCategory =
  | 'Bone & Joint Health'
  | 'Brain Health'
  | 'Cardiovascular Health'
  | "Children's Health"
  | 'Digestive Health'
  | 'Energy'
  | 'Enhancers'
  | 'Eye Health'
  | 'Immune Health'
  | "Men's Health"
  | 'Skin & Body Care'
  | 'Sleep Support'
  | 'Sports Nutrition'
  | 'Weight Management'
  | "Women's Health"
  | 'Other';

export type StockStatus = 'In Stock' | 'Low Stock' | 'Out of Stock';

export type ExpiryStatus = 'Expired' | 'Expiring Soon' | 'OK';

export type MovementType = 'IN' | 'OUT' | 'ADJUST' | 'WRITE_OFF';

/** Reasons accepted by `POST /batches/{productId}/{expiry}/write-off`. */
export type WriteOffReason = 'Expired' | 'Damaged' | 'Other';

/**
 * Catalogue item. Stock does NOT live here — it lives on Batch rows.
 * `totalQuantity` and `earliestExpiry` are caches the server maintains
 * transactionally on every stock change; batches remain the source of truth.
 */
export interface Product {
  id: string;
  name: string;
  nameLower?: string;        // normalized for search (mirrors Client.clientNameLower)
  stockNo?: string;          // Herbalife stock no. e.g. "1239", "127K"
  category: ProductCategory;
  brand?: string;

  // Pricing — VP plus every discount tier (see utils/pricing.ts).
  vp: number;                // volume points per piece; tier-independent
  retail: number;            // 0% price
  price25: number;
  price35: number;
  price42: number;
  price50: number;           // 50% = cost / default buy price

  unit?: string;             // 'units', 'bottles', 'boxes' …
  reorderLevel: number;      // low-stock threshold (Low Stock when totalQuantity <= this)

  // Cached roll-ups of this product's batches:
  totalQuantity: number;     // Σ batch.quantity
  earliestExpiry?: IsoDate;  // min(batch.expiryDate) — drives the product-level badge

  notes?: string;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

/**
 * One lot of stock: a product + a single expiry + a quantity.
 * Keyed by (productId, expiryDate) so a same-expiry restock merges automatically.
 */
export interface Batch {
  id: string;                // = `${productId}#${expiryDate}`
  productId: string;
  productName?: string;      // snapshot for readability
  expiryDate: IsoDate;
  quantity: number;          // units in THIS batch
  invDate?: IsoDate;         // server-maintained GSI6-InventoryDate key (= expiryDate)
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

/**
 * Append-only audit record. Written server-side only, as a side effect of
 * invoice finalization, batch correction or write-off — there is no
 * `POST /stock-movements`.
 */
export interface StockMovement {
  id: string;
  productId: string;
  productName?: string;
  batchExpiry?: IsoDate;     // which batch this movement touched
  type: MovementType;        // IN = purchase, OUT = sale, ADJUST = correction, WRITE_OFF = expired/damaged
  quantity: number;          // always positive; sign implied by `type`
  reason?: string;           // 'Sale — INV-…', 'Purchase — PUR-…', 'Expired' …
  createdAt: IsoTimestamp;
}

// ── Invoicing ───────────────────────────────────────────────────────────────

export type DiscountTier = 0 | 25 | 35 | 42 | 50;

export type InvoiceType = 'SALE' | 'PURCHASE';

export type InvoiceStatus = 'Draft' | 'Finalized' | 'Cancelled';

/**
 * Embedded line. Every price field is a SNAPSHOT taken at save time so a
 * historical invoice never changes when the catalogue is repriced.
 */
export interface InvoiceLine {
  productId: string;
  stockNo?: string;          // snapshot, for the printed bill
  name: string;              // snapshot
  unitPrice: number;         // snapshot of the price at the invoice's tier
  unitVp: number;            // snapshot of product.vp (per piece)
  quantity: number;
  lineAmount: number;        // unitPrice × quantity
  lineVp: number;            // unitVp × quantity
  expiryDate: IsoDate;       // the batch touched — SALE: sold from; PURCHASE: shipment expiry
  unitCost?: number;         // = product.price50 — INTERNAL, never rendered on a SALE bill
}

export interface Invoice {
  id: string;                // client-generated uuid; also the sort key (INVOICE#<id>)
  type: InvoiceType;
  invoiceNo: string;         // "INV-2026-0001" / "PUR-2026-0007"
  date: IsoDate;             // the document's calendar date
  tier: DiscountTier;        // SALE: chosen. PURCHASE: always 50
  // Party — customer on a SALE ("Billed to"), supplier on a PURCHASE ("Bought from").
  partyName: string;
  partyPhone?: string;
  partyEmail?: string;
  partyAddress?: string;
  lines: InvoiceLine[];
  totalAmount: number;       // Σ lineAmount
  totalVp: number;           // Σ lineVp (PURCHASE: VP earned)
  totalCost?: number;        // SALE internal Σ unitCost×qty — never printed
  status: InvoiceStatus;
  stockApplied: boolean;     // true once stock has actually moved
  notes?: string;
  invDate?: IsoTimestamp;    // server-maintained GSI6-InventoryDate key (= createdAt)
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}
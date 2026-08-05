# Biztrack

Biztrack is a comprehensive business management dashboard designed for independent business owners, supervisors, and network marketers. It serves as a central hub for managing client relationships (CRM), tracking daily tasks, visualizing organizational structures, and scheduling follow-ups.

## 🚀 Key Features

- **Client Management (CRM):** Maintain a detailed database of clients, manage follow-ups, and track call outcomes to prevent lost leads.
- **Task Management:** Create, track, and manage priority tasks with a clear view of overdue, pending, and completed items.
- **Team Visualization:** Dynamic, zoomable Organization Tree to easily manage and visualize your downline/team structure.
- **Calendar & Scheduling:** Integrated calendar view to manage upcoming client calls and deadlines.
- **Dashboard Overview:** Real-time metric cards for calls due, active tasks, and recent activity to keep you focused.
- **Inventory & Invoicing:** Batch-tracked stock by expiry date, with sales and purchase invoices.
- **Data Privacy & Security:** Cognito authentication; every record is partitioned by the signed-in user's ID, taken from the verified token.

## 🛠 Tech Stack

- **Frontend:** React 19, Vite, TypeScript
- **Styling:** Tailwind CSS
- **Routing:** React Router DOM
- **Auth:** AWS Cognito (user pool + hosted UI)
- **API:** API Gateway (REST) + AWS Lambda (Node 24)
- **Database:** DynamoDB, single-table design
- **Hosting:** S3 + CloudFront
- **Infrastructure:** AWS CDK (`infra/`), region `ap-south-1`
- **Icons:** FontAwesome

## 💻 Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm
- Access to the deployed AWS stack (Cognito user pool + API Gateway), or your own
  `cd infra && npx cdk deploy`

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mananmaheshwari1702/Biztrack.git
   cd Biztrack
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Copy `.env.example` to `.env` and fill in the values from the CDK stack outputs
   (`cd infra && npx cdk deploy` prints them):
   ```env
   VITE_COGNITO_USER_POOL_ID=   # CDK output: UserPoolId
   VITE_COGNITO_CLIENT_ID=      # CDK output: UserPoolClientId
   VITE_COGNITO_DOMAIN=         # CDK output: CognitoDomain
   VITE_API_URL=                # CDK output: ApiUrl  (absolute — used by builds)
   VITE_APP_URL=                # CDK output: CloudFrontUrl
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:5173`.

## 🧑‍💻 Local development

### The API proxy — why `npm run dev` needs `.env.local`

The deployed API's CORS allowlist trusts **only** the CloudFront origin. That is
deliberate: security audit **C3** replaced a wildcard `*` with an explicit allowlist.

The consequence is that a browser at `http://localhost:5173` cannot call the API
directly. The preflight still returns `204`, but its
`Access-Control-Allow-Origin` names CloudFront, so the browser discards the
response. It surfaces as an opaque *"CORS error"* rather than a clear 4xx:

```
OPTIONS /products   Origin: http://localhost:5173
→ 204,  Access-Control-Allow-Origin: https://d3o7zfo5sdvcnd.cloudfront.net   ✗ mismatch
```

**We do not fix this by adding localhost to the production allowlist.** Instead
the Vite dev server proxies API calls (see `server.proxy` in `vite.config.ts`):
the browser calls same-origin `/api/*`, Vite forwards it to API Gateway
server-side, and CORS never applies — no preflight is even sent.

To enable it, create a **`.env.development.local`** in the repo root:

```env
VITE_API_URL=/api
```

> ⚠️ **Use `.env.development.local`, not `.env.local`.** Vite loads `.env.local`
> in *every* mode, including `vite build` — so `VITE_API_URL=/api` there gets
> baked into the production bundle, and the deployed app calls `/api/*` on the
> CloudFront origin where nothing is listening. `.env.development.local` loads
> only in development mode, so `npm run build` still reads the absolute URL from
> `.env`. Both are gitignored.

Vite layers `.env` → `.env.development` → `.env.development.local` **per key**,
so Cognito settings still come from `.env`; only the API URL changes locally.

To proxy somewhere other than the default prod API, export
`VITE_API_PROXY_TARGET` before `npm run dev`.

Sign-in needs no special setup: the Cognito app client already registers
`http://localhost:5173` as a callback/logout URL, so only the API was ever blocked.

### Use a dedicated Cognito dev user

Local development runs against the **production** table. Data is partitioned per
user (`PK = USER#<uid>`, with `uid` taken from the verified token), so signing in
as a dedicated dev account gives you complete isolation from real data without a
second table or stack — you cannot read or write another user's rows.

**Create one, then use it for all local work.** See
`docs/followups/README.md` → *FU-B6* for why a fully separate dev stack is
deferred rather than done.

### Stop the dev server before `cdk deploy` or `cdk diff`

```bash
# from the repo root, before deploying
pkill -f vite            # POSIX
Stop-Process -Name node  # Windows, if pkill doesn't match
```

Leaving `npm run dev` running makes CDK fail with:

```
«FailedToBundleAsset» Failed to bundle asset .../Code/Stage
Error: EPERM: operation not permitted, rename
  '...\cdk.out\bundling-temp-<hash>-building' -> '...\cdk.out\bundling-temp-<hash>'
```

**The message never names the cause.** It reads like a permissions or antivirus
problem, and clearing `cdk.out` does not fix it.

What actually happens: the Lambda asset is *bundled*, not copied (see the asset
block in `infra/lib/biztrack-stack.ts`), so `cdk synth` runs
`npm ci --omit=dev` and writes ~31 MB of `node_modules` into `infra/cdk.out/`.
That directory sits inside the repo the Vite dev server is watching, so
chokidar opens the new files, and CDK's rename of the temp directory to its
final name fails while those handles are held. Most visible on Windows, where
renaming a directory with open handles is denied outright.

Stopping the dev server fixes it immediately. Restart it afterwards — nothing
about the deploy touches your local setup.

### Building for Production

To create a production build:
```bash
npm run build
```

To preview the production build locally:
```bash
npm run preview
```

## 📂 Project Structure

- `src/features/<feature>/`: Each feature owns its `pages/`, `components/` and `hooks/`
  (auth, calendar, clients, dashboard, inventory, profile, tasks, team).
- `src/shared/`: Cross-feature code — `components/`, `context/`, `services/` (API client),
  `utils/`, `types/`, `constants/`.
- `lambda/src/`: API handlers, one file per resource, with shared helpers in `lambda/src/lib/`.
- `infra/`: AWS CDK app defining the whole stack.
- `docs/`: `PROJECT.md` (how it works and why), `RULES.md` (business rules), `LOG.md`
  (change history), plus `specs/` and `followups/`.

## 📐 Engineering standard

This project follows the company AI Engineering Operating System, vendored at
`.ai-eos/` and imported by `AGENTS.md` at the root. Start at
[`docs/PROJECT.md`](docs/PROJECT.md) — §8 records where this app deliberately
deviates from the standard, and why.

Before deploying, run `./verify.sh`.

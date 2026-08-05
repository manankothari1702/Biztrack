import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

export class BiztrackStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // ─────────────────────────────────────────────────────────────────────
        // 1. COGNITO — replaces Firebase Auth
        // ─────────────────────────────────────────────────────────────────────

        const userPool = new cognito.UserPool(this, 'BiztrackUserPool', {
            userPoolName: 'biztrack-users',
            selfSignUpEnabled: true,
            signInAliases: { email: true },
            autoVerify: { email: true },
            passwordPolicy: {
                // Hardened (audit C2). Config-only — existing passwords keep working; the new
                // rule applies to new sign-ups / password changes. Keep the frontend signup
                // validation (Login.tsx) in sync so users get clear inline errors.
                minLength: 12,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            standardAttributes: {
                email:    { required: true,  mutable: true },
                fullname: { required: false, mutable: true },
                // NOTE: profilePicture / givenName / familyName cannot be added
                // to an existing UserPool — Cognito rejects standard-attribute
                // changes. If those are ever needed, do it via a new pool +
                // user migration.
            },
            // Custom attributes stored per user
            customAttributes: {
                level:     new cognito.StringAttribute({ mutable: true }),
                avatarColor: new cognito.StringAttribute({ mutable: true }),
            },
            email: cognito.UserPoolEmail.withCognito(),
            removalPolicy: cdk.RemovalPolicy.RETAIN, // never auto-delete user accounts
        });

        const userPoolClient = new cognito.UserPoolClient(this, 'BiztrackWebClient', {
            userPool,
            userPoolClientName: 'biztrack-web',
            generateSecret: false, // public SPA client
            authFlows: {
                userPassword: true,
                userSrp: true,           // secure remote password (recommended)
                custom: true,
            },
            oAuth: {
                flows: { authorizationCodeGrant: true },
                scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
                callbackUrls: ['http://localhost:5173', 'https://d3o7zfo5sdvcnd.cloudfront.net'],
                logoutUrls:   ['http://localhost:5173', 'https://d3o7zfo5sdvcnd.cloudfront.net'],
            },
            supportedIdentityProviders: [
                cognito.UserPoolClientIdentityProvider.COGNITO,
            ],
            accessTokenValidity:  cdk.Duration.hours(1),
            idTokenValidity:      cdk.Duration.hours(1),
            refreshTokenValidity: cdk.Duration.days(30),
        });

        const userPoolDomain = new cognito.UserPoolDomain(this, 'BiztrackDomain', {
            userPool,
            cognitoDomain: { domainPrefix: 'biztrack-auth' },
        });

        // ─────────────────────────────────────────────────────────────────────
        // 2. DYNAMODB — replaces Firestore
        //    Single-table design:
        //    PK = USER#{uid}   SK = PROFILE | CLIENT#{id} | TASK#{id} | ORG#{id}
        // ─────────────────────────────────────────────────────────────────────

        const table = new dynamodb.Table(this, 'BiztrackTable', {
            tableName: 'biztrack',
            partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
            sortKey:      { name: 'SK', type: dynamodb.AttributeType.STRING },
            billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST, // scales to zero
            pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
            timeToLiveAttribute: 'expiresAt', // auto-expire META rate-limit rows; only touches items that have expiresAt
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // GSI 1: query clients by nextFollowUpDate (due-calls list, dashboard)
        table.addGlobalSecondaryIndex({
            indexName: 'GSI1-FollowUpDate',
            partitionKey: { name: 'PK',               type: dynamodb.AttributeType.STRING },
            sortKey:      { name: 'nextFollowUpDate',  type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // GSI 2: query tasks by status + dueDate (task list, dashboard counts)
        table.addGlobalSecondaryIndex({
            indexName: 'GSI2-TaskStatus',
            partitionKey: { name: 'PK',     type: dynamodb.AttributeType.STRING },
            sortKey:      { name: 'dueDate', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // GSI 3: search clients by name (prefix search via clientNameLower)
        table.addGlobalSecondaryIndex({
            indexName: 'GSI3-ClientName',
            partitionKey: { name: 'PK',             type: dynamodb.AttributeType.STRING },
            sortKey:      { name: 'clientNameLower', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // GSI 4: search clients by phone digits
        table.addGlobalSecondaryIndex({
            indexName: 'GSI4-MobileDigits',
            partitionKey: { name: 'PK',           type: dynamodb.AttributeType.STRING },
            sortKey:      { name: 'mobileDigits',  type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // GSI 5: global scheduler scan — find users whose reportTime matches now
        //        PK = REPORT_SCHEDULE  SK = HH:MM#timezone#uid
        table.addGlobalSecondaryIndex({
            indexName: 'GSI5-ReportSchedule',
            partitionKey: { name: 'reportSchedulePK', type: dynamodb.AttributeType.STRING },
            sortKey:      { name: 'reportScheduleSK',  type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.INCLUDE,
            nonKeyAttributes: ['uid', 'phoneNumber', 'countryCode', 'name', 'timezone'],
        });

        // GSI 6: inventory dates — ONE index serving two entities, both keyed on
        //        the user partition with a date sort key called `invDate`:
        //
        //          Batch    invDate = expiryDate  -> "expiring between today and
        //                                            today+N", and "expired"
        //          Invoice  invDate = createdAt   -> chronological, newest-first
        //
        //        They can share because the index is sparse (only these two write
        //        `invDate`) and every query filters by SK prefix anyway —
        //        begins_with(SK,'BATCH#') or begins_with(SK,'INVOICE#') — exactly
        //        as GSI1/GSI2 already do for clients and tasks.
        //
        //        Sharing is what lets the invoice sort key stay INVOICE#<id>:
        //        point reads by id and the attribute_not_exists(PK) idempotency
        //        guard both need the id alone to be the whole key, so ordering
        //        cannot live in the sort key. See 07_BUILD_PLAN.md C7.
        //
        //        NOTE: CloudFormation permits only ONE GSI addition per stack
        //        update. That is the sole reason this index ships in a deploy of
        //        its own, ahead of the handlers that query it.
        table.addGlobalSecondaryIndex({
            indexName: 'GSI6-InventoryDate',
            partitionKey: { name: 'PK',      type: dynamodb.AttributeType.STRING },
            sortKey:      { name: 'invDate', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // ─────────────────────────────────────────────────────────────────────
        // 3. LAMBDA EXECUTION ROLE
        // ─────────────────────────────────────────────────────────────────────

        const lambdaRole = new iam.Role(this, 'BiztrackLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });

        // DynamoDB access
        table.grantReadWriteData(lambdaRole);

        // Secrets Manager. Read-only access to this app's secrets, for the WhatsApp
        // scheduler and test endpoint. Read is the only verb the runtime needs:
        // secrets are created and rotated out of band, never by application code. The
        // trailing wildcard is required because AWS appends a 6 character suffix to
        // every secret ARN, so `secret:biztrack/whatsapp/token` alone would never match.
        // This replaced an ssm:GetParameter grant once no Lambda read Parameter Store.
        lambdaRole.addToPolicy(new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: [
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:biztrack/*`,
            ],
        }));

        // ─────────────────────────────────────────────────────────────────────
        // S3 + CLOUDFRONT (frontend hosting). Created before the Lambdas/API so the
        // CloudFront domain can be DERIVED (not hardcoded) into the CORS allowlist below.
        // ─────────────────────────────────────────────────────────────────────

        const siteBucket = new s3.Bucket(this, 'BiztrackSiteBucket', {
            bucketName: `biztrack-frontend-${this.account}`,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // Security headers at the ingress (AI-EOS adoption, 2026-08-05). Before
        // this, the distribution set none at all.
        //
        // Content-Security-Policy is deliberately ABSENT rather than guessed. A
        // wrong CSP breaks a live SPA silently — the page renders blank and the
        // only clue is in the browser console. It needs a report-only rollout
        // measured against real traffic first; tracked as FU-EOS-3.
        const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'BiztrackSecurityHeaders', {
            responseHeadersPolicyName: 'biztrack-security-headers',
            comment: 'HSTS, nosniff, referrer policy and frame denial for the Biztrack SPA',
            securityHeadersBehavior: {
                strictTransportSecurity: {
                    accessControlMaxAge: cdk.Duration.days(365),
                    includeSubdomains: true,
                    // preload stays OFF: submitting a *.cloudfront.net host to the
                    // preload list is not ours to do, and it is not reversible quickly.
                    preload: false,
                    override: true,
                },
                contentTypeOptions: { override: true },              // X-Content-Type-Options: nosniff
                referrerPolicy: {
                    referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
                    override: true,
                },
                frameOptions: {
                    frameOption: cloudfront.HeadersFrameOption.DENY,  // the app is never framed
                    override: true,
                },
            },
        });

        const distribution = new cloudfront.Distribution(this, 'BiztrackCDN', {
            defaultBehavior: {
                origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                responseHeadersPolicy: securityHeaders,
                compress: true,
            },
            defaultRootObject: 'index.html',
            // SPA: serve index.html for all 403/404 (client-side routing)
            errorResponses: [
                { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
                { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
            ],
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US/EU/AP — cheapest
        });

        // CORS allowlist (audit C3). Derived from the CloudFront distribution — no hardcoded
        // origin that breaks in another deploy. Environment-aware: localhost is trusted ONLY
        // in dev (`cdk deploy -c env=dev`), NEVER in prod. Used by BOTH the API Gateway
        // preflight and the Lambda response headers (lib/response.ts) so the two layers agree.
        const isDev = this.node.tryGetContext('env') === 'dev';
        const appOrigin = `https://${distribution.distributionDomainName}`;
        const allowedOrigins = isDev ? [appOrigin, 'http://localhost:5173'] : [appOrigin];

        // ─────────────────────────────────────────────────────────────────────
        // 4. LAMBDA FUNCTIONS — one per domain (thin handlers, shared layer later)
        // ─────────────────────────────────────────────────────────────────────

        const commonEnv = {
            TABLE_NAME:       table.tableName,
            ALLOWED_ORIGINS:  allowedOrigins.join(','),
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        };

        // Dedicated role for lambdas that touch Cognito admin APIs (user, purge).
        // Kept separate from the shared lambdaRole because the shared role is
        // used by the Cognito post-confirmation trigger — referencing
        // userPool.userPoolArn from that role would create a circular
        // dependency (userPool ↔ trigger lambda ↔ role).
        const adminLambdaRole = new iam.Role(this, 'BiztrackAdminLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });
        table.grantReadWriteData(adminLambdaRole);
        adminLambdaRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'cognito-idp:AdminUserGlobalSignOut',
                'cognito-idp:AdminDeleteUser',
            ],
            resources: [userPool.userPoolArn],
        }));

        // ── Lambda code asset ────────────────────────────────────────────────
        //
        // Handler paths are "dist/<file>.handler", matching the tsc output layout.
        //
        // The asset is BUNDLED rather than copied. Previously it packaged the whole
        // lambda/ directory, which meant every function shipped the full dev
        // toolchain — typescript alone is 24 MB, plus vitest/vite/@vitest — for a
        // 36 MB zip that never runs any of it. Bundling replaces the asset contents
        // with exactly what tryBundle writes to `outputDir`, so nothing ships unless
        // it is copied there deliberately: compiled output, the manifests, and a
        // production-only dependency tree from `npm ci --omit=dev`.
        //
        // `npm ci` (not `install`) so the tree is reproduced from the lockfile, and
        // `--ignore-scripts` so a synth never executes package lifecycle hooks.
        //
        // AssetHashType.OUTPUT makes the asset's identity the bundled result. That
        // is both correct (identity = what ships) and much cheaper than the default,
        // which would hash-walk all 96 MB of the source node_modules.
        //
        // Local bundling runs npm directly; the Docker image is only a fallback for
        // machines without a usable node/npm on PATH.
        const lambdaRoot     = path.join(__dirname, '../../lambda');
        const lambdaDistPath = path.join(lambdaRoot, 'dist');

        const lambdaCode = fs.existsSync(lambdaDistPath)
            ? lambda.Code.fromAsset(lambdaRoot, {
                assetHashType: cdk.AssetHashType.OUTPUT,
                bundling: {
                    // Kept on the same Node major as the runtime above, so the
                    // Docker fallback path builds against what the code runs on.
                    image: lambda.Runtime.NODEJS_24_X.bundlingImage,
                    command: [
                        'bash', '-c',
                        'cp -r dist package.json package-lock.json /asset-output/ '
                        + '&& cd /asset-output '
                        + '&& npm ci --omit=dev --ignore-scripts',
                    ],
                    local: {
                        tryBundle(outputDir: string): boolean {
                            try {
                                fs.cpSync(lambdaDistPath, path.join(outputDir, 'dist'), { recursive: true });
                                for (const manifest of ['package.json', 'package-lock.json']) {
                                    fs.copyFileSync(
                                        path.join(lambdaRoot, manifest),
                                        path.join(outputDir, manifest),
                                    );
                                }
                                execSync('npm ci --omit=dev --ignore-scripts', {
                                    cwd:   outputDir,
                                    stdio: 'inherit',
                                });
                                return true;
                            } catch {
                                return false;   // hand off to the Docker image above
                            }
                        },
                    },
                },
              })
            : lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 200 })');

        // Runtime choice (2026-07-23). AWS's published schedule:
        //
        //   nodejs20.x   deprecated 2026-04-30 · updates BLOCKED 2027-03-03
        //   nodejs22.x   deprecates  2027-04-30 · updates blocked 2027-07-01
        //   nodejs24.x   deprecates  2028-04-30 · updates blocked 2028-07-01
        //
        // 24 over 22 because it buys a full extra year on the date that actually
        // hurts — the one after which no code change can be deployed to an
        // existing function — at no cost: every @aws-sdk package declares
        // `node >=20.0.0`, axios declares no engine, and no transitive dependency
        // sets an upper bound. Both are Amazon Linux 2023. CDK itself moved its
        // internal S3AutoDeleteObjects helper to nodejs24.x in 2.262.0.
        //
        // The AWS SDK also warns that releases after early Jan 2027 will require
        // node >=22, which 24 satisfies and 20 does not.
        const lambdaDefaults = {
            runtime:     lambda.Runtime.NODEJS_24_X,
            role:        lambdaRole,
            timeout:     cdk.Duration.seconds(29),
            memorySize:  256,
            environment: commonEnv,
        } satisfies Partial<lambda.FunctionProps>;

        // ── Reserved concurrency (Phase C, audit B4) ────────────────────────
        // GATED OFF by default. Enable ONLY after the Lambda account concurrency
        // quota is raised to >=300 (Phase A) via:  cdk deploy -c reserveConcurrency=true
        // AWS requires >=100 unreserved concurrency to remain in the account, so at
        // the current account limit of 10 ANY reserved value fails `cdk deploy`. With
        // the flag OFF, rc() returns {} so no reservedConcurrentExecutions is set and
        // every function stays unreserved (shared pool) -> deploy succeeds at limit 10.
        // NOTE: the numbers at each call site assume the quota is raised to ~1000.
        // Before enabling, recompute against the ACTUAL confirmed limit and re-verify
        // sum(reserved) <= (limit - 100). Planned: user 60, clients 50, dashboard 30,
        // tasks 30, products 30, batches 20, invoices 20, stockMovements 10,
        // whatsappTest 5, scheduler 2, purge 2, postConfirmation UNRESERVED (signup
        // critical-path) = 259 total (was 239 before invoices, 179 before inventory).
        const reserveConcurrency =
            this.node.tryGetContext('reserveConcurrency') === true ||
            this.node.tryGetContext('reserveConcurrency') === 'true';
        const rc = (n: number): { reservedConcurrentExecutions?: number } =>
            reserveConcurrency ? { reservedConcurrentExecutions: n } : {};

        // ─────────────────────────────────────────────────────────────────────
        // 4a. POST-CONFIRMATION TRIGGER — creates DynamoDB profile for new users
        //     (email sign-ups after Cognito verification)
        // ─────────────────────────────────────────────────────────────────────

        const postConfirmationLambda = new lambda.Function(this, 'PostConfirmationHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-post-confirmation',
            code: lambdaCode,
            handler: 'dist/cognitoPostConfirmation.handler',
            timeout: cdk.Duration.seconds(10),
            // Intentionally UNRESERVED (Phase C): signup critical-path, rare — benefits
            // from the shared pool (the heavy functions are capped so can't drain it).
        });

        userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationLambda);

        // Health probe (AI-EOS platform contract §1). Unauthenticated and cheap:
        // one DescribeTable control-plane call, no business table read. Detail is
        // gated behind HEALTH_TOKEN, which is unset by default so detail cannot
        // leak by misconfiguration. Set it with `-c healthToken=<value>` once a
        // monitoring token exists in the password manager.
        const healthLambda = new lambda.Function(this, 'HealthHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-health',
            code: lambdaCode,
            handler: 'dist/health.handler',
            timeout: cdk.Duration.seconds(5),   // must stay pollable every 30s
            memorySize: 128,
            environment: {
                ...commonEnv,
                APP_VERSION:  String(this.node.tryGetContext('appVersion') ?? 'unknown'),
                HEALTH_TOKEN: String(this.node.tryGetContext('healthToken') ?? ''),
            },
            // Intentionally UNRESERVED: it must answer even when the app is
            // being throttled, otherwise monitoring goes blind exactly when it
            // matters most.
        });

        // Clients CRUD
        const clientsLambda = new lambda.Function(this, 'ClientsHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-clients',
            code: lambdaCode,
            handler: 'dist/clients.handler',
            ...rc(50), // expensive (bulk/list) — caps B1/B2 concurrent blast radius
        });

        // Tasks CRUD
        const tasksLambda = new lambda.Function(this, 'TasksHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-tasks',
            code: lambdaCode,
            handler: 'dist/tasks.handler',
            ...rc(30), // cheap interactive CRUD — generous
        });

        // ── Inventory & invoicing ───────────────────────────────────────────

        // Product catalogue CRUD + Excel bulk upsert + a product's batches
        const productsLambda = new lambda.Function(this, 'ProductsHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-products',
            code: lambdaCode,
            handler: 'dist/products.handler',
            ...rc(30), // bulk import is the heavy path — mirrors clients
        });

        // Expiry range queries (GSI6), manual batch corrections, write-offs.
        // Every mutation here runs a DynamoDB transaction via lib/stock.ts.
        const batchesLambda = new lambda.Function(this, 'BatchesHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-batches',
            code: lambdaCode,
            handler: 'dist/batches.handler',
            ...rc(20), // interactive, low volume
        });

        // Read-only audit log. No write path exists at all.
        const stockMovementsLambda = new lambda.Function(this, 'StockMovementsHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-stock-movements',
            code: lambdaCode,
            handler: 'dist/stockMovements.handler',
            ...rc(10), // cheapest of the three; one list query
        });

        // Sales + purchases. Create/finalize/cancel each run a DynamoDB
        // transaction via lib/stock.ts (invoice + batches + roll-ups + movements).
        //
        // No `functionName`: per the phase constraint, NEW resources carry no
        // hardcoded physical name, so CDK generates one. Its 11 siblings are
        // still named — parameterising all of them is FU-B6 (the dev-stack
        // prerequisite), not this phase. Referenced everywhere by construct, so
        // the generated name is never needed in code.
        const invoicesLambda = new lambda.Function(this, 'InvoicesHandler', {
            ...lambdaDefaults,
            code: lambdaCode,
            handler: 'dist/invoices.handler',
            ...rc(20), // transaction-bearing, interactive — mirrors batches
        });

        // Dashboard (counts + lists)
        const dashboardLambda = new lambda.Function(this, 'DashboardHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-dashboard',
            code: lambdaCode,
            handler: 'dist/dashboard.handler',
            ...rc(30), // expensive 6-query aggregate; bounded (one per nav)
        });

        // User profile + org nodes — uses adminLambdaRole because DELETE /user
        // calls AdminUserGlobalSignOut. Env var and role both set per-lambda
        // (not commonEnv / lambdaRole) to avoid a circular dep with the post-
        // confirmation Cognito trigger.
        const userLambda = new lambda.Function(this, 'UserHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-user',
            code: lambdaCode,
            handler: 'dist/user.handler',
            role: adminLambdaRole,
            environment: { ...commonEnv, USER_POOL_ID: userPool.userPoolId },
            ...rc(60), // highest frequency: 30s profile+org poll per active session
        });

        // WhatsApp daily report scheduler (triggered by EventBridge)
        const whatsappSchedulerLambda = new lambda.Function(this, 'WhatsAppScheduler', {
            ...lambdaDefaults,
            functionName: 'biztrack-whatsapp-scheduler',
            code: lambdaCode,
            handler: 'dist/whatsappScheduler.handler',
            timeout: cdk.Duration.seconds(120),
            ...rc(2), // one invocation/minute; 2 covers run-overlap
        });

        // WhatsApp test (called directly from frontend via API Gateway)
        const whatsappTestLambda = new lambda.Function(this, 'WhatsAppTest', {
            ...lambdaDefaults,
            functionName: 'biztrack-whatsapp-test',
            code: lambdaCode,
            handler: 'dist/whatsappTest.handler',
            ...rc(5), // already per-user capped (item 1: 10/day, 1/hr); tiny volume
        });

        // Scheduled account purge — permanently deletes accounts whose 7-day
        // recovery window has elapsed. Larger timeout/memory because it may
        // batch-delete thousands of rows per account.
        const purgeAccountsLambda = new lambda.Function(this, 'PurgeAccountsHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-purge-accounts',
            code: lambdaCode,
            handler: 'dist/purgeAccounts.handler',
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            role: adminLambdaRole,
            environment: { ...commonEnv, USER_POOL_ID: userPool.userPoolId },
            ...rc(2), // daily single 5-min run
        });

        // ─────────────────────────────────────────────────────────────────────
        // 5. EVENTBRIDGE — replaces Cloud Scheduler (runs every minute)
        // ─────────────────────────────────────────────────────────────────────

        const schedulerRule = new events.Rule(this, 'WhatsAppSchedulerRule', {
            ruleName: 'biztrack-whatsapp-every-minute',
            schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
        });
        schedulerRule.addTarget(new targets.LambdaFunction(whatsappSchedulerLambda));

        // Daily account purge — runs at 03:00 UTC to permanently delete accounts
        // whose 7-day recovery window has expired.
        const purgeRule = new events.Rule(this, 'PurgeAccountsRule', {
            ruleName: 'biztrack-purge-accounts-daily',
            schedule: events.Schedule.cron({ minute: '0', hour: '3' }),
        });
        purgeRule.addTarget(new targets.LambdaFunction(purgeAccountsLambda));

        // ─────────────────────────────────────────────────────────────────────
        // 6. API GATEWAY — replaces Firebase callable functions
        //    All routes are Cognito-authorized
        // ─────────────────────────────────────────────────────────────────────

        const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuth', {
            cognitoUserPools: [userPool],
            authorizerName: 'biztrack-cognito-auth',
            identitySource: 'method.request.header.Authorization',
        });

        const api = new apigateway.RestApi(this, 'BiztrackApi', {
            restApiName: 'biztrack-api',
            description: 'Biztrack CRM REST API',
            defaultCorsPreflightOptions: {
                allowOrigins: allowedOrigins, // audit C3 — allowlist, not '*' (env-aware; see above)
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Content-Type', 'Authorization'],
            },
            deployOptions: {
                stageName: 'prod',
                // Phase B (audit B4) — PALLIATIVE, NOT THE CURE. Aligns the front door to
                // the ~10-concurrency backend so overflow returns clean edge 429s instead
                // of ugly Lambda-level throttle 500s. It does NOT fix "10 slots is too few
                // for normal operation" — only raising the account concurrency quota
                // (Phase A) does. POST-PHASE-A TARGET: raise stage back toward ~100/200 and
                // the per-method caps below proportionally.
                throttlingRateLimit: 25,
                throttlingBurstLimit: 50,
                methodOptions: {
                    // Most expensive read (6-query aggregate). Post-Phase-A target ~20/40.
                    '/dashboard/GET':       { throttlingRateLimit: 5, throttlingBurstLimit: 10 },
                    // Heaviest writes (bulk import/delete). Post-Phase-A target ~10/20.
                    '/clients/bulk/POST':   { throttlingRateLimit: 2, throttlingBurstLimit: 5 },
                    '/clients/bulk/DELETE': { throttlingRateLimit: 2, throttlingBurstLimit: 5 },
                    // Excel catalogue import: reads every existing product, then
                    // writes in batches. Same cost profile as /clients/bulk.
                    '/products/bulk/POST':  { throttlingRateLimit: 2, throttlingBurstLimit: 5 },
                    // Invoice create: a BatchGet + counter update + a multi-item
                    // transaction (invoice + batches + roll-ups + movements). The
                    // heaviest write in the app after the bulk imports, so it gets
                    // the same cap. finalize/cancel are {id} sub-paths and not
                    // separately throttled — they run the same transaction but are
                    // one-per-invoice, not fan-out.
                    '/invoices/POST':       { throttlingRateLimit: 2, throttlingBurstLimit: 5 },
                },
            },
        });

        const authOptions: apigateway.MethodOptions = {
            authorizer: cognitoAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        };

        // /health — THE ONLY UNAUTHENTICATED ROUTE, deliberately.
        // `authOptions` is omitted, not forgotten: a health check that needs a
        // token cannot be polled by a load balancer or an uptime monitor, which
        // is the entire point of the endpoint. Never add an authorizer here, and
        // never remove this route (PLATFORM.md §1).
        const healthResource = api.root.addResource('health');
        healthResource.addMethod('GET', new apigateway.LambdaIntegration(healthLambda));

        // /clients  GET + POST
        const clientsResource = api.root.addResource('clients');
        clientsResource.addMethod('GET',  new apigateway.LambdaIntegration(clientsLambda), authOptions);
        clientsResource.addMethod('POST', new apigateway.LambdaIntegration(clientsLambda), authOptions);

        // /clients/{id}  GET + PUT + DELETE
        const clientResource = clientsResource.addResource('{id}');
        clientResource.addMethod('GET',    new apigateway.LambdaIntegration(clientsLambda), authOptions);
        clientResource.addMethod('PUT',    new apigateway.LambdaIntegration(clientsLambda), authOptions);
        clientResource.addMethod('DELETE', new apigateway.LambdaIntegration(clientsLambda), authOptions);

        // /clients/bulk  POST (bulk import / delete)
        const clientsBulk = clientsResource.addResource('bulk');
        clientsBulk.addMethod('POST',   new apigateway.LambdaIntegration(clientsLambda), authOptions);
        clientsBulk.addMethod('DELETE', new apigateway.LambdaIntegration(clientsLambda), authOptions);

        // /tasks
        const tasksResource = api.root.addResource('tasks');
        tasksResource.addMethod('GET',  new apigateway.LambdaIntegration(tasksLambda), authOptions);
        tasksResource.addMethod('POST', new apigateway.LambdaIntegration(tasksLambda), authOptions);

        const taskResource = tasksResource.addResource('{id}');
        taskResource.addMethod('GET',    new apigateway.LambdaIntegration(tasksLambda), authOptions);
        taskResource.addMethod('PUT',    new apigateway.LambdaIntegration(tasksLambda), authOptions);
        taskResource.addMethod('DELETE', new apigateway.LambdaIntegration(tasksLambda), authOptions);

        // ── Inventory & invoicing routes ────────────────────────────────────

        // /products  GET + POST
        const productsResource = api.root.addResource('products');
        productsResource.addMethod('GET',  new apigateway.LambdaIntegration(productsLambda), authOptions);
        productsResource.addMethod('POST', new apigateway.LambdaIntegration(productsLambda), authOptions);

        // /products/bulk  POST + DELETE (Excel import / bulk delete).
        // Declared BEFORE /products/{id} for readability only — API Gateway always
        // prefers a literal segment over a path parameter, so 'bulk' can never be
        // captured as an {id}. Same arrangement as /clients/bulk.
        const productsBulk = productsResource.addResource('bulk');
        productsBulk.addMethod('POST',   new apigateway.LambdaIntegration(productsLambda), authOptions);
        productsBulk.addMethod('DELETE', new apigateway.LambdaIntegration(productsLambda), authOptions);

        // /products/{id}  GET + PUT + DELETE
        const productResource = productsResource.addResource('{id}');
        productResource.addMethod('GET',    new apigateway.LambdaIntegration(productsLambda), authOptions);
        productResource.addMethod('PUT',    new apigateway.LambdaIntegration(productsLambda), authOptions);
        productResource.addMethod('DELETE', new apigateway.LambdaIntegration(productsLambda), authOptions);

        // /products/{id}/batches  GET — the batch picker's source
        const productBatches = productResource.addResource('batches');
        productBatches.addMethod('GET', new apigateway.LambdaIntegration(productsLambda), authOptions);

        // /batches  GET — expiry range queries over GSI6-InventoryDate
        const batchesResource = api.root.addResource('batches');
        batchesResource.addMethod('GET', new apigateway.LambdaIntegration(batchesLambda), authOptions);

        // /batches/{productId}/{expiry}  PUT — manual correction (ADJUST, may re-key)
        const batchProduct  = batchesResource.addResource('{productId}');
        const batchResource = batchProduct.addResource('{expiry}');
        batchResource.addMethod('PUT', new apigateway.LambdaIntegration(batchesLambda), authOptions);

        // /batches/{productId}/{expiry}/write-off  POST — zero a batch, log WRITE_OFF
        const batchWriteOff = batchResource.addResource('write-off');
        batchWriteOff.addMethod('POST', new apigateway.LambdaIntegration(batchesLambda), authOptions);

        // /stock-movements  GET only. The handler answers every other verb with
        // 405; movements are written solely by lib/stock.ts inside transactions.
        const stockMovementsResource = api.root.addResource('stock-movements');
        stockMovementsResource.addMethod('GET', new apigateway.LambdaIntegration(stockMovementsLambda), authOptions);

        // ── Invoices (sales + purchases) ────────────────────────────────────

        // /invoices  GET (list, newest-first via GSI6) + POST (create, ?finalize)
        const invoicesResource = api.root.addResource('invoices');
        invoicesResource.addMethod('GET',  new apigateway.LambdaIntegration(invoicesLambda), authOptions);
        invoicesResource.addMethod('POST', new apigateway.LambdaIntegration(invoicesLambda), authOptions);

        // /invoices/{id}  GET + PUT (Draft only) + DELETE (Draft only)
        const invoiceResource = invoicesResource.addResource('{id}');
        invoiceResource.addMethod('GET',    new apigateway.LambdaIntegration(invoicesLambda), authOptions);
        invoiceResource.addMethod('PUT',    new apigateway.LambdaIntegration(invoicesLambda), authOptions);
        invoiceResource.addMethod('DELETE', new apigateway.LambdaIntegration(invoicesLambda), authOptions);

        // /invoices/{id}/finalize  POST — re-reads, re-prices, applies stock.
        // The handler routes on the /finalize suffix via event.resource, so the
        // literal segment must exist as its own API Gateway resource.
        const invoiceFinalize = invoiceResource.addResource('finalize');
        invoiceFinalize.addMethod('POST', new apigateway.LambdaIntegration(invoicesLambda), authOptions);

        // /invoices/{id}/cancel  POST — reverses stock (SALE adds back, PURCHASE removes).
        const invoiceCancel = invoiceResource.addResource('cancel');
        invoiceCancel.addMethod('POST', new apigateway.LambdaIntegration(invoicesLambda), authOptions);

        // /dashboard
        const dashboardResource = api.root.addResource('dashboard');
        dashboardResource.addMethod('GET', new apigateway.LambdaIntegration(dashboardLambda), authOptions);

        // /user  (profile + org nodes)
        const userResource = api.root.addResource('user');
        userResource.addMethod('GET',    new apigateway.LambdaIntegration(userLambda), authOptions);
        userResource.addMethod('PUT',    new apigateway.LambdaIntegration(userLambda), authOptions);
        userResource.addMethod('DELETE', new apigateway.LambdaIntegration(userLambda), authOptions);

        const orgResource = userResource.addResource('org');
        orgResource.addMethod('GET',  new apigateway.LambdaIntegration(userLambda), authOptions);
        orgResource.addMethod('POST', new apigateway.LambdaIntegration(userLambda), authOptions);

        const orgNodeResource = orgResource.addResource('{nodeId}');
        orgNodeResource.addMethod('PUT',    new apigateway.LambdaIntegration(userLambda), authOptions);
        orgNodeResource.addMethod('DELETE', new apigateway.LambdaIntegration(userLambda), authOptions);

        // /whatsapp/test
        const whatsappResource = api.root.addResource('whatsapp');
        const whatsappTest = whatsappResource.addResource('test');
        whatsappTest.addMethod('POST', new apigateway.LambdaIntegration(whatsappTestLambda), authOptions);

        // (S3 + CloudFront moved above the Lambda/API section so the CORS allowlist can
        //  derive the CloudFront domain — see the "S3 + CLOUDFRONT" block earlier.)

        // ─────────────────────────────────────────────────────────────────────
        // 8. STACK OUTPUTS — values the frontend .env needs
        // ─────────────────────────────────────────────────────────────────────

        new cdk.CfnOutput(this, 'UserPoolId', {
            value: userPool.userPoolId,
            description: 'Cognito User Pool ID -> VITE_COGNITO_USER_POOL_ID',
        });

        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: userPoolClient.userPoolClientId,
            description: 'Cognito App Client ID -> VITE_COGNITO_CLIENT_ID',
        });

        new cdk.CfnOutput(this, 'CognitoDomain', {
            value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
            description: 'Cognito Hosted UI domain -> VITE_COGNITO_DOMAIN',
        });

        new cdk.CfnOutput(this, 'ApiUrl', {
            value: api.url,
            description: 'API Gateway URL -> VITE_API_URL',
        });

        new cdk.CfnOutput(this, 'CloudFrontUrl', {
            value: `https://${distribution.distributionDomainName}`,
            description: 'Frontend URL',
        });

        new cdk.CfnOutput(this, 'HealthUrl', {
            value: `${api.url}health`,
            description: 'Unauthenticated health probe - poll this for monitoring',
        });

        new cdk.CfnOutput(this, 'SiteBucketName', {
            value: siteBucket.bucketName,
            description: 'S3 bucket for frontend deploy',
        });

        new cdk.CfnOutput(this, 'DynamoTableName', {
            value: table.tableName,
            description: 'DynamoDB table name',
        });
    }
}

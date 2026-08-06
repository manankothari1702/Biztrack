import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
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

        // ── Reserved concurrency (Phase C, audit B4 · FU-0) ─────────────────
        // Enable with:  cdk deploy -c reserveConcurrency=true
        //
        // A reservation is BOTH a floor and a ceiling: it guarantees the function
        // that capacity, and caps its blast radius at the same number. That dual
        // nature is the whole point — one bulk import can no longer starve signup.
        //
        // PREREQUISITE, now satisfied. AWS requires >=100 unreserved concurrency to
        // remain in the account. The account sat at the new-account floor of 10 until
        // 2026-08-06, where ANY reserved value failed `cdk deploy`; the quota is now
        // 1000 (confirmed via `aws lambda get-account-settings`, not via the approval
        // mail — the case can close before the limit is applied).
        //
        // Sizing method:  reservation >= throttle_rate x (p95_duration + cold_start).
        // Cold start is ~370ms and is EXCLUDED from the Duration metric while still
        // holding the slot, so it must be added by hand. Measured 30-day peaks were
        // 1-4 per function, so every value below carries 10-30x headroom.
        //
        //   user 60, clients 50, dashboard 30, tasks 30, products 30, batches 20,
        //   invoices 20, stockMovements 10, health 5, whatsappTest 5, scheduler 5,
        //   purge 2, postConfirmation UNRESERVED  = 267 total
        //   (was 259 before FU-0 corrected health and scheduler; 239 before invoices;
        //    179 before inventory). Leaves 733 unreserved against a floor of 100.
        //
        // With the flag OFF, rc() returns {} and every function stays unreserved.
        // Re-tune on TRIGGER, not on a calendar: any per-function Throttles > 0,
        // sustained concurrency above 60% of a reservation, or any change to the API
        // Gateway rate limits below — the two are coupled by the formula above.
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
            // RESERVED, deliberately (FU-0). This was unreserved, with the comment
            // "it must answer even when the app is being throttled" — which is the
            // right goal reached by exactly the wrong mechanism. Unreserved means
            // "shares the common pool with no floor", so under exhaustion the probe
            // is throttled alongside everything it is supposed to be reporting on,
            // and monitoring goes blind at the one moment it matters. A reservation
            // is the only construct that guarantees capacity. 5 is not sized to load
            // — measured demand is 0.015 concurrent — it is sized to stay answerable
            // during an incident with room for a second monitor and a manual curl.
            ...rc(5),
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
            // 5, not the 2 originally planned (FU-0). "One invocation/minute, 2
            // covers run-overlap" counted the EventBridge tick but not Lambda's
            // async retry policy: a failing async invocation is retried twice, so
            // one tick can occupy THREE slots. Measured, not theorised — during the
            // 2026-08-05 outage this function ran at 180 invocations/hour against a
            // rule that fires 60/hour, peaking at 3 concurrent. At a reservation of
            // 2 the third retry would hit its own ceiling, and throttled async
            // invokes are themselves retried — a second amplification loop stacked
            // on the one the original number missed.
            ...rc(5),
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
                // Phase B was PALLIATIVE: 25/50 shrank the front door to fit a
                // 10-concurrency backend. FU-0 removed that constraint (quota now
                // 1000, reservations now cap each function individually), so the
                // stage returns to its designed width. This is deliberately the LAST
                // step of FU-0 — raising the front door before the reservations exist
                // would remove the only thing protecting the shared pool.
                //
                // 25/50 was also the binding ceiling on the whole app, and not where
                // anyone would look for it: at 2 polled requests per session per 30s,
                // 25 req/s is reached at ~375 concurrently open sessions with nobody
                // clicking anything. 100/200 moves that to ~1,500.
                throttlingRateLimit: 100,
                throttlingBurstLimit: 200,
                methodOptions: {
                    // Most expensive read (6-query aggregate). 20 x (p95 1,108ms +
                    // 370ms cold start) = 29.4 concurrent, against a reservation of 30.
                    '/dashboard/GET':       { throttlingRateLimit: 20, throttlingBurstLimit: 40 },
                    // Heaviest writes (bulk import/delete). 5/10, NOT the 10/20 the
                    // Phase B comment projected. Each import holds its slot for the
                    // full 20s wall-clock guard, so the RATE term is what bites:
                    // 10 req/s sustained would demand 200 concurrent against a
                    // reservation of 50. The burst term is the realistic shape for a
                    // human-driven import (10 x 20s = 10 concurrent) and fits easily.
                    // Do not raise these without re-sizing clients/products first.
                    '/clients/bulk/POST':   { throttlingRateLimit: 5, throttlingBurstLimit: 10 },
                    '/clients/bulk/DELETE': { throttlingRateLimit: 5, throttlingBurstLimit: 10 },
                    // Excel catalogue import: reads every existing product, then
                    // writes in batches. Same cost profile as /clients/bulk.
                    '/products/bulk/POST':  { throttlingRateLimit: 5, throttlingBurstLimit: 10 },
                    // Invoice create: a BatchGet + counter update + a multi-item
                    // transaction (invoice + batches + roll-ups + movements). The
                    // heaviest write in the app after the bulk imports, so it gets
                    // the same cap. finalize/cancel are {id} sub-paths and not
                    // separately throttled — they run the same transaction but are
                    // one-per-invoice, not fan-out.
                    '/invoices/POST':       { throttlingRateLimit: 5, throttlingBurstLimit: 10 },
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
        //
        // GET *and* HEAD, and they are the only unauthenticated methods in the
        // whole API. API Gateway routes on the exact (resource, method) pair and
        // does NOT synthesize HEAD from GET the way nginx, Apache and Express do,
        // so a monitor or load balancer sending HEAD gets 403
        // MissingAuthenticationToken — an error whose name means "no such route",
        // not "no credentials". Supporting the verb once beats configuring every
        // future monitoring tool around the gap. HEAD is safe here for the reason
        // the endpoint is public in the first place: the handler never inspects
        // the verb, so HEAD returns the same headers GET does and reveals nothing
        // extra. One integration serves both methods.
        const healthResource    = api.root.addResource('health');
        const healthIntegration = new apigateway.LambdaIntegration(healthLambda);
        healthResource.addMethod('GET',  healthIntegration);
        healthResource.addMethod('HEAD', healthIntegration);

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
        // 7. MONITORING — five alarms, one channel, one dashboard (FU-EOS-6)
        //
        // Before this section the account had zero alarms, zero SNS topics and
        // zero dashboards. That is how `biztrack-whatsapp-scheduler` failed
        // 4,320 times a day for at least 31 days with nobody knowing: nothing
        // was watching. Everything below exists to make that silence impossible.
        //
        // THE TRAFFIC SHAPE DICTATES THE DESIGN. Measured over the 14 days to
        // 2026-08-05: 0-444 API requests/day, and ELEVEN of those fourteen days
        // saw zero traffic at all. p50 51ms, p99 1,699ms (cold starts). So:
        //   - rate alarms (errors ÷ invocations) divide by ~0 and flap. Not used.
        //   - latency alarms fire on cold starts, not on problems.  Not used.
        //   - EVERY alarm needs an explicit treatMissingData, or the eleven
        //     quiet days alarm on their own.
        // ─────────────────────────────────────────────────────────────────────

        // The one notification channel. NO subscription is declared here, and
        // that is deliberate, not an omission:
        //   - this repository is PUBLIC, so an address in the stack is published;
        //   - a `-c alertEmail=...` context value would be silently DELETED by
        //     the next deploy that forgot the flag, restoring exactly the
        //     blindness this section removes, with no error to show for it.
        // The owner subscribes once, out of band:
        //
        //   aws sns subscribe --topic-arn <AlertsTopicArn> \
        //     --protocol email --notification-endpoint <address>
        //
        // then clicks the confirmation link. `verify.sh` fails while that
        // subscription is missing OR unconfirmed, because an unconfirmed
        // subscription accepts alarms and throws them away.
        const alertsTopic = new sns.Topic(this, 'BiztrackAlerts', {
            topicName:   'biztrack-alerts',
            displayName: 'Biztrack alerts',
        });

        const notify = new cwActions.SnsAction(alertsTopic);

        // Every alarm notifies on the way IN and on the way OUT. Alarms here are
        // rare by construction, so a "resolved" mail is signal rather than noise.
        // This helper exists for one reason only: it makes it impossible to add
        // an alarm that has nowhere to send anything — the precise failure this
        // whole section is here to fix.
        const alarm = (id: string, props: cloudwatch.AlarmProps): cloudwatch.Alarm => {
            const a = new cloudwatch.Alarm(this, id, props);
            a.addAlarmAction(notify);
            a.addOkAction(notify);
            return a;
        };

        const FIVE_MIN = cdk.Duration.minutes(5);

        // ── 1. API returned a 5XX ───────────────────────────────────────────
        // Dimension is ApiName ONLY, never ApiName+Stage: a stage rename would
        // silently blind a Stage-scoped alarm and nothing would say so.
        // Threshold 1 — at 0-444 requests/day, one server error IS the incident.
        alarm('ApiServerErrorAlarm', {
            alarmName: 'biztrack-api-5xx',
            alarmDescription:
                'API Gateway returned a 5XX, so a signed-in user just saw a server error. '
                + 'Open the biztrack dashboard and read the per-function Lambda errors graph '
                + 'to see which handler failed.',
            metric: api.metricServerError({ statistic: 'Sum', period: FIVE_MIN }),
            threshold: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            evaluationPeriods: 1,
            // 11 of 14 days have no traffic at all, so no data must mean healthy.
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // ── 2. Any Lambda errored, ACCOUNT-WIDE ─────────────────────────────
        // Deliberately undimensioned, for two reasons.
        //
        // FIRST, it is the only alarm that can see async work, and alarm 1
        // cannot substitute for it. Measured 2026-08-05: `biztrack-tasks`
        // recorded 5 Lambda errors at 08:30 UTC while ApiGateway 5XXError was 0
        // for three days straight. EventBridge targets, the Cognito post-
        // confirmation trigger and direct invokes never touch API Gateway at
        // all — which is exactly why the WhatsApp scheduler could fail 130,000
        // times unseen.
        //
        // SECOND, one alarm instead of thirteen, for $0.10/month instead of
        // $1.30. Every Lambda in this account belongs to Biztrack. Attribution
        // comes from the per-function graph on the dashboard, which is where you
        // look anyway once the mail arrives.
        //
        // REVIEW TRIGGER: threshold 1 is right at ~4,300 invocations/day. Past
        // roughly 50,000/day it becomes noise, and the replacement is
        // per-function alarms plus an error-RATE alarm. Recorded in docs/RULES.md
        // so the number has an owner instead of quietly rotting.
        alarm('LambdaErrorsAlarm', {
            alarmName: 'biztrack-lambda-errors',
            alarmDescription:
                'A Lambda function raised an error. This covers scheduled and async work that '
                + 'never reaches API Gateway, including the WhatsApp scheduler, the daily purge '
                + 'and the Cognito post confirmation trigger.',
            metric: new cloudwatch.Metric({
                namespace:  'AWS/Lambda',
                metricName: 'Errors',
                statistic:  'Sum',
                period:     FIVE_MIN,
            }),
            threshold: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // ── 3. A Lambda was throttled, ACCOUNT-WIDE ─────────────────────────
        // A throttle is never normal here: measured throttles over 30 days = 0.
        //
        // FU-0 changed what a throttle MEANS, without changing this alarm. Before,
        // every function shared one pool of 10, so any throttle meant "the account
        // is exhausted". Now each function has its own reservation, so a throttle
        // means one of two different things — and this alarm, being undimensioned,
        // fires identically for both. The description carries the split because the
        // description is the runbook somebody reads at 3am.
        alarm('LambdaThrottlesAlarm', {
            alarmName: 'biztrack-lambda-throttles',
            alarmDescription:
                'A Lambda invocation was throttled. Since FU-0 this means one of two different '
                + 'things, and this alarm cannot tell them apart because it is account-wide. '
                + 'Find which function by graphing AWS/Lambda Throttles with a FunctionName '
                + 'dimension in CloudWatch Metrics. IF ONE FUNCTION IS RESPONSIBLE: it hit its '
                + 'OWN reserved concurrency, so that reservation is too low - raise it. IF NO '
                + 'SINGLE FUNCTION IS RESPONSIBLE: the unreserved pool is exhausted, which hits '
                + 'biztrack-post-confirmation (signup) first because it is the only function '
                + 'with no reservation to fall back on - raise the account quota or lower total '
                + 'reservations.',
            metric: new cloudwatch.Metric({
                namespace:  'AWS/Lambda',
                metricName: 'Throttles',
                statistic:  'Sum',
                period:     FIVE_MIN,
            }),
            threshold: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // ── 4. DynamoDB throttled a request ─────────────────────────────────
        // NOT `ThrottledRequests`, which the reviewed design named. That metric
        // is only published WITH an Operation dimension, so a TableName-only
        // alarm on it would sit at INSUFFICIENT_DATA forever and never fire.
        // AWS CDK marks its own `table.metricThrottledRequests()` as
        // "@deprecated Do not use this function. It returns an invalid metric."
        // for exactly this reason.
        //
        // ReadThrottleEvents and WriteThrottleEvents ARE published at TableName
        // granularity, and their sum is the same signal, correctly measured.
        // Two metrics in the expression, so this alarm costs ~$0.20 not $0.10.
        const ddbThrottleEvents = new cloudwatch.MathExpression({
            expression: 'reads + writes',
            usingMetrics: {
                reads:  table.metric('ReadThrottleEvents',  { statistic: 'Sum', period: FIVE_MIN }),
                writes: table.metric('WriteThrottleEvents', { statistic: 'Sum', period: FIVE_MIN }),
            },
            period: FIVE_MIN,
            label:  'Throttled reads and writes',
        });

        alarm('DynamoThrottleAlarm', {
            alarmName: 'biztrack-dynamodb-throttles',
            alarmDescription:
                'DynamoDB throttled a read or a write on the biztrack table. On an on-demand '
                + 'table this means a hot partition or a burst above the current scaling '
                + 'ceiling. Requests are failing.',
            metric: ddbThrottleEvents,
            threshold: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // ── 5. The daily purge stopped running ──────────────────────────────
        // The only ABSENCE alarm here, and the only failure in this app that is
        // invisible to all four alarms above. `docs/PROJECT.md` §10 promises
        // PENDING_DELETION accounts are purged. If the EventBridge rule is
        // disabled or deleted, nothing errors, nothing 5XXs, and that promise
        // quietly stops being true.
        //
        // NOT "Sum < 1 over 24h" as the reviewed design worded it. CloudWatch
        // aligns one-day periods to 00:00 UTC, and Lambda publishes NO datapoint
        // at all when a function is not invoked. The purge runs at 03:00 UTC, so
        // every day between 00:00 and 03:00 the current period is missing data,
        // which under treatMissingData BREACHING is a false alarm every single
        // morning.
        //
        // Instead: five consecutive 6-hour windows with no invocation. Measured
        // cadence is exactly one run per day (7 of 7 days), which leaves at most
        // THREE consecutive empty windows in healthy operation — so this cannot
        // false-positive, and it fires about 33h after a genuine stoppage. A
        // daily housekeeping job does not need to be caught faster than that.
        alarm('PurgeNotRunningAlarm', {
            alarmName: 'biztrack-purge-not-running',
            alarmDescription:
                'biztrack-purge-accounts has not run for over 30 hours. It is scheduled daily at '
                + '03:00 UTC. Accounts past their 7 day recovery window are no longer being '
                + 'purged, so the retention promise in docs/PROJECT.md section 10 is not being '
                + 'kept. Check the EventBridge rule biztrack-purge-accounts-daily is enabled.',
            metric: purgeAccountsLambda.metricInvocations({
                statistic: 'Sum',
                period:    cdk.Duration.hours(6),
            }),
            threshold: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
            evaluationPeriods: 5,
            datapointsToAlarm: 5,
            // The ONE alarm that inverts this. Here absence IS the failure: a
            // window with no datapoint is a window where the job did not run.
            treatMissingData: cloudwatch.TreatMissingData.BREACHING,
        });

        // ── The dashboard ───────────────────────────────────────────────────
        // One URL that answers "is it fine?" for a chartered accountant rather
        // than an engineer. It also carries the attribution that alarms 2 and 3
        // deliberately gave up by being account-wide.
        const allFunctions: lambda.Function[] = [
            postConfirmationLambda, healthLambda, clientsLambda, tasksLambda,
            productsLambda, batchesLambda, stockMovementsLambda, invoicesLambda,
            dashboardLambda, userLambda, whatsappSchedulerLambda, whatsappTestLambda,
            purgeAccountsLambda,
        ];

        const dashboard = new cloudwatch.Dashboard(this, 'BiztrackDashboard', {
            dashboardName:   'biztrack',
            defaultInterval: cdk.Duration.days(7),
        });

        dashboard.addWidgets(
            new cloudwatch.TextWidget({
                markdown:
                    '# Biztrack\n'
                    + 'Alarms mail `biztrack-alerts`. Empty graphs are normal: 11 of the last 14 '
                    + 'days had no traffic at all.\n\n'
                    + '**Estimated charges covers the WHOLE AWS account**, not just Biztrack, and '
                    + 'stays blank until Billing preferences has "Receive Billing Alerts" turned on.',
                width: 24, height: 3,
            }),
        );

        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'API requests and 5XX',
                left:  [api.metricCount({ statistic: 'Sum', period: FIVE_MIN })],
                right: [api.metricServerError({ statistic: 'Sum', period: FIVE_MIN })],
                width: 12, height: 6,
            }),
            new cloudwatch.GraphWidget({
                title: 'API latency p50 and p99 (ms)',
                left: [
                    api.metricLatency({ statistic: 'p50', period: FIVE_MIN, label: 'p50' }),
                    api.metricLatency({ statistic: 'p99', period: FIVE_MIN, label: 'p99' }),
                ],
                width: 12, height: 6,
            }),
        );

        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Lambda errors by function - WHICH handler is failing',
                left:  allFunctions.map((fn) => fn.metricErrors({
                    statistic: 'Sum',
                    period:    FIVE_MIN,
                    label:     fn.functionName,
                })),
                width: 12, height: 6,
            }),
            new cloudwatch.GraphWidget({
                title: 'Lambda concurrency and throttles',
                left: [new cloudwatch.Metric({
                    namespace:  'AWS/Lambda',
                    metricName: 'ConcurrentExecutions',
                    statistic:  'Maximum',
                    period:     FIVE_MIN,
                    label:      'Concurrent executions (account)',
                })],
                right: [new cloudwatch.Metric({
                    namespace:  'AWS/Lambda',
                    metricName: 'Throttles',
                    statistic:  'Sum',
                    period:     FIVE_MIN,
                    label:      'Throttles (account)',
                })],
                // The account ceiling. Moved 10 -> 1000 by FU-0 on 2026-08-06; the
                // old line was drawn at the new-account floor. MOVE THIS AGAIN if
                // the quota changes, or the line becomes a lie.
                leftAnnotations: [{
                    value: 1000,
                    label: 'account concurrency limit 1000 (FU-0)',
                    color: cloudwatch.Color.RED,
                }],
                width: 12, height: 6,
            }),
        );

        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'DynamoDB consumed capacity',
                left: [
                    table.metricConsumedReadCapacityUnits({ statistic: 'Sum', period: FIVE_MIN }),
                    table.metricConsumedWriteCapacityUnits({ statistic: 'Sum', period: FIVE_MIN }),
                ],
                width: 8, height: 6,
            }),
            new cloudwatch.GraphWidget({
                title: 'DynamoDB throttled reads and writes',
                left:  [ddbThrottleEvents],
                width: 8, height: 6,
            }),
            // Dashboard-only, by decision: the $25 AWS Budget already alerts on
            // cost, and a second cost alert is a duplicate, not a safety net.
            // AWS/Billing is published ONLY in us-east-1, so both the metric and
            // the widget are pinned there — a widget left in ap-south-1 would
            // render permanently empty and look like zero spend.
            new cloudwatch.GraphWidget({
                title:  'Estimated AWS charges, whole account (USD)',
                region: 'us-east-1',
                left: [new cloudwatch.Metric({
                    namespace:     'AWS/Billing',
                    metricName:    'EstimatedCharges',
                    dimensionsMap: { Currency: 'USD' },
                    statistic:     'Maximum',
                    period:        cdk.Duration.hours(6),
                    region:        'us-east-1',
                    label:         'Estimated charges',
                })],
                width: 8, height: 6,
            }),
        );

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

        new cdk.CfnOutput(this, 'AlertsTopicArn', {
            value: alertsTopic.topicArn,
            // No subscription ships in the stack (public repo, and a context flag
            // would be deleted by the next deploy that forgot it). Subscribe once:
            //   aws sns subscribe --topic-arn <this> --protocol email \
            //     --notification-endpoint <address>
            description: 'Alarm topic - subscribe an email to it once, then confirm the link',
        });

        new cdk.CfnOutput(this, 'DashboardUrl', {
            value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home`
                 + `?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
            description: 'CloudWatch dashboard for Biztrack',
        });
    }
}

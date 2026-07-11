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

        // SSM for WhatsApp secrets
        lambdaRole.addToPolicy(new iam.PolicyStatement({
            actions: ['ssm:GetParameter', 'ssm:GetParameters'],
            resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/biztrack/*`,
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

        const distribution = new cloudfront.Distribution(this, 'BiztrackCDN', {
            defaultBehavior: {
                origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
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

        // Lambda code — package the whole lambda/ directory (dist/ + node_modules/)
        // Handler paths use "dist/filename.handler" to match compiled output location.
        const lambdaDistPath = path.join(__dirname, '../../lambda/dist');
        const lambdaCode = require('fs').existsSync(lambdaDistPath)
            ? lambda.Code.fromAsset(path.join(__dirname, '../../lambda'), {
                exclude: ['src/**', 'tsconfig.json'],
              })
            : lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 200 })');

        const lambdaDefaults = {
            runtime:     lambda.Runtime.NODEJS_20_X,
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
        // tasks 30, whatsappTest 5, scheduler 2, purge 2, postConfirmation UNRESERVED
        // (signup critical-path) = 179 total.
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
                },
            },
        });

        const authOptions: apigateway.MethodOptions = {
            authorizer: cognitoAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        };

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
            description: 'Cognito User Pool ID → VITE_COGNITO_USER_POOL_ID',
        });

        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: userPoolClient.userPoolClientId,
            description: 'Cognito App Client ID → VITE_COGNITO_CLIENT_ID',
        });

        new cdk.CfnOutput(this, 'CognitoDomain', {
            value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
            description: 'Cognito Hosted UI domain → VITE_COGNITO_DOMAIN',
        });

        new cdk.CfnOutput(this, 'ApiUrl', {
            value: api.url,
            description: 'API Gateway URL → VITE_API_URL',
        });

        new cdk.CfnOutput(this, 'CloudFrontUrl', {
            value: `https://${distribution.distributionDomainName}`,
            description: 'Frontend URL',
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

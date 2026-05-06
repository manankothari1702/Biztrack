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
import * as ssm from 'aws-cdk-lib/aws-ssm';
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
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: false,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            standardAttributes: {
                email: { required: true, mutable: true },
                fullname: { required: false, mutable: true },
            },
            // Custom attributes stored per user
            customAttributes: {
                level:     new cognito.StringAttribute({ mutable: true }),
                avatarColor: new cognito.StringAttribute({ mutable: true }),
            },
            email: cognito.UserPoolEmail.withCognito(),
            removalPolicy: cdk.RemovalPolicy.RETAIN, // never auto-delete user accounts
        });

        // Google OAuth identity provider
        // Credentials added manually via console or via CfnUserPoolIdentityProvider
        // after getting client ID/secret from Google Cloud Console
        const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
            userPool,
            clientId: ssm.StringParameter.valueForStringParameter(this, '/biztrack/google/client-id'),
            // SecureString not supported in CFN — read as plain String; rotate via SSM console
            clientSecretValue: cdk.SecretValue.unsafePlainText(
                ssm.StringParameter.valueForStringParameter(this, '/biztrack/google/client-secret')
            ),
            scopes: ['email', 'profile', 'openid'],
            attributeMapping: {
                email: cognito.ProviderAttribute.GOOGLE_EMAIL,
                fullname: cognito.ProviderAttribute.GOOGLE_NAME,
                profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
            },
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
                cognito.UserPoolClientIdentityProvider.GOOGLE,
            ],
            accessTokenValidity:  cdk.Duration.hours(1),
            idTokenValidity:      cdk.Duration.hours(1),
            refreshTokenValidity: cdk.Duration.days(30),
        });

        userPoolClient.node.addDependency(googleProvider);

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
        // 4. LAMBDA FUNCTIONS — one per domain (thin handlers, shared layer later)
        // ─────────────────────────────────────────────────────────────────────

        const commonEnv = {
            TABLE_NAME:       table.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        };

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

        // ─────────────────────────────────────────────────────────────────────
        // 4a. POST-CONFIRMATION TRIGGER — creates DynamoDB profile for new users
        //     (email sign-ups after verification AND first Google federated sign-in)
        // ─────────────────────────────────────────────────────────────────────

        const postConfirmationLambda = new lambda.Function(this, 'PostConfirmationHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-post-confirmation',
            code: lambdaCode,
            handler: 'dist/cognitoPostConfirmation.handler',
            timeout: cdk.Duration.seconds(10),
        });

        userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationLambda);

        // Clients CRUD
        const clientsLambda = new lambda.Function(this, 'ClientsHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-clients',
            code: lambdaCode,
            handler: 'dist/clients.handler',
        });

        // Tasks CRUD
        const tasksLambda = new lambda.Function(this, 'TasksHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-tasks',
            code: lambdaCode,
            handler: 'dist/tasks.handler',
        });

        // Dashboard (counts + lists)
        const dashboardLambda = new lambda.Function(this, 'DashboardHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-dashboard',
            code: lambdaCode,
            handler: 'dist/dashboard.handler',
        });

        // User profile + org nodes
        const userLambda = new lambda.Function(this, 'UserHandler', {
            ...lambdaDefaults,
            functionName: 'biztrack-user',
            code: lambdaCode,
            handler: 'dist/user.handler',
        });

        // WhatsApp daily report scheduler (triggered by EventBridge)
        const whatsappSchedulerLambda = new lambda.Function(this, 'WhatsAppScheduler', {
            ...lambdaDefaults,
            functionName: 'biztrack-whatsapp-scheduler',
            code: lambdaCode,
            handler: 'dist/whatsappScheduler.handler',
            timeout: cdk.Duration.seconds(120),
        });

        // WhatsApp test (called directly from frontend via API Gateway)
        const whatsappTestLambda = new lambda.Function(this, 'WhatsAppTest', {
            ...lambdaDefaults,
            functionName: 'biztrack-whatsapp-test',
            code: lambdaCode,
            handler: 'dist/whatsappTest.handler',
        });

        // ─────────────────────────────────────────────────────────────────────
        // 5. EVENTBRIDGE — replaces Cloud Scheduler (runs every minute)
        // ─────────────────────────────────────────────────────────────────────

        const schedulerRule = new events.Rule(this, 'WhatsAppSchedulerRule', {
            ruleName: 'biztrack-whatsapp-every-minute',
            schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
        });
        schedulerRule.addTarget(new targets.LambdaFunction(whatsappSchedulerLambda));

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
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Content-Type', 'Authorization'],
            },
            deployOptions: {
                stageName: 'prod',
                throttlingRateLimit: 100,
                throttlingBurstLimit: 200,
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
        userResource.addMethod('GET', new apigateway.LambdaIntegration(userLambda), authOptions);
        userResource.addMethod('PUT', new apigateway.LambdaIntegration(userLambda), authOptions);

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

        // ─────────────────────────────────────────────────────────────────────
        // 7. S3 + CLOUDFRONT — replaces Firebase Hosting
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

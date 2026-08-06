import * as cdk from 'aws-cdk-lib/core';
import * as cxapi from 'aws-cdk-lib/cx-api';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BiztrackStack } from '../lib/biztrack-stack';

// Synthesising the stack stages the lambda/ asset, which is slow enough to blow
// the default 5s timeout. Do it once for the whole file.
jest.setTimeout(120_000);

let template: Template;

beforeAll(() => {
    // BUNDLING_STACKS = [] disables asset bundling for every stack. Without it
    // each run would shell out to `npm ci --omit=dev`, making the suite slow and
    // dependent on registry access. These tests assert the CloudFormation
    // template, which the asset's contents do not affect.
    const app = new cdk.App({ context: { [cxapi.BUNDLING_STACKS]: [] } });
    const stack = new BiztrackStack(app, 'TestStack', {
        env: { account: '123456789012', region: 'ap-south-1' },
    });
    template = Template.fromStack(stack);
});

describe('DynamoDB table', () => {
    test('is the single "biztrack" table, retained on stack delete', () => {
        template.hasResource('AWS::DynamoDB::Table', {
            Properties: Match.objectLike({ TableName: 'biztrack' }),
            DeletionPolicy: 'Retain',
        });
    });

    test('GSI6-InventoryDate exists: PK + invDate, full projection', () => {
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'biztrack',
            GlobalSecondaryIndexes: Match.arrayWith([
                Match.objectLike({
                    IndexName: 'GSI6-InventoryDate',
                    KeySchema: [
                        { AttributeName: 'PK',      KeyType: 'HASH'  },
                        { AttributeName: 'invDate', KeyType: 'RANGE' },
                    ],
                    Projection: { ProjectionType: 'ALL' },
                }),
            ]),
        });
    });

    test('invDate is declared as a string attribute', () => {
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'biztrack',
            AttributeDefinitions: Match.arrayWith([
                { AttributeName: 'invDate', AttributeType: 'S' },
            ]),
        });
    });

    // GSI3 is client-name search, NOT batch expiry — the mistake the spec pack
    // originally made. Assert the existing five are untouched by the addition.
    test('the five pre-existing indexes are unchanged', () => {
        const table = Object.values(template.findResources('AWS::DynamoDB::Table'))[0];
        const byName: Record<string, { KeySchema: { AttributeName: string; KeyType: string }[] }> =
            Object.fromEntries(
                (table.Properties.GlobalSecondaryIndexes as { IndexName: string }[])
                    .map(i => [i.IndexName, i as never]),
            );

        expect(Object.keys(byName).sort()).toEqual([
            'GSI1-FollowUpDate',
            'GSI2-TaskStatus',
            'GSI3-ClientName',
            'GSI4-MobileDigits',
            'GSI5-ReportSchedule',
            'GSI6-InventoryDate',
        ]);

        const sortKeyOf = (name: string) =>
            byName[name].KeySchema.find(k => k.KeyType === 'RANGE')?.AttributeName;

        expect(sortKeyOf('GSI1-FollowUpDate')).toBe('nextFollowUpDate');
        expect(sortKeyOf('GSI2-TaskStatus')).toBe('dueDate');
        expect(sortKeyOf('GSI3-ClientName')).toBe('clientNameLower');
        expect(sortKeyOf('GSI4-MobileDigits')).toBe('mobileDigits');
        expect(sortKeyOf('GSI5-ReportSchedule')).toBe('reportScheduleSK');
        expect(sortKeyOf('GSI6-InventoryDate')).toBe('invDate');
    });

    test('exactly one index is added per deploy — CloudFormation allows no more', () => {
        // The live table has five. If this count ever jumps by more than one in
        // a single change, the deploy will fail; split it.
        const table = Object.values(template.findResources('AWS::DynamoDB::Table'))[0];
        expect((table.Properties.GlobalSecondaryIndexes as unknown[]).length).toBe(6);
    });
});

describe('inventory Lambda functions', () => {
    test.each([
        ['biztrack-products',        'dist/products.handler'],
        ['biztrack-batches',         'dist/batches.handler'],
        ['biztrack-stock-movements', 'dist/stockMovements.handler'],
    ])('%s is wired to %s', (functionName, handler) => {
        // Deliberately does NOT assert the runtime — see the runtime describe
        // block below, which checks it once for every function instead of
        // repeating a version string that goes stale on each Node bump.
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: functionName,
            Handler:      handler,
        });
    });

    test('they get the shared table + CORS environment', () => {
        for (const functionName of ['biztrack-products', 'biztrack-batches', 'biztrack-stock-movements']) {
            template.hasResourceProperties('AWS::Lambda::Function', {
                FunctionName: functionName,
                Environment: { Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }) },
            });
        }
    });

    test('invoices is wired to dist/invoices.handler', () => {
        // Found by HANDLER, not FunctionName: invoices is the first function
        // under the "no hardcoded physical names on new resources" rule, so it
        // has no stable name to assert on.
        template.hasResourceProperties('AWS::Lambda::Function', {
            Handler: 'dist/invoices.handler',
        });
    });

    test('the invoices function carries no hardcoded physical name', () => {
        // The point of the rule: a second stack can coexist only if new
        // resources let CloudFormation name them. Its 11 siblings are still
        // named — migrating those is FU-B6, not this phase.
        const invoices = appFunctions().find(fn => fn.Properties?.Handler === 'dist/invoices.handler');
        expect(invoices).toBeDefined();
        expect(invoices!.Properties?.FunctionName).toBeUndefined();
    });

    test('the stack declares 13 app functions — 12 named + the unnamed invoices', () => {
        // Counted by HANDLER (`dist/*.handler`), which is what separates our
        // functions from CDK's own internal helper (S3AutoDeleteObjects, handler
        // `index.handler`). Name-counting would silently miss the unnamed
        // invoices function, so it has to be handler-based now.
        // 12 -> 13 on 2026-08-05: biztrack-health, the AI-EOS health contract.
        const app = appFunctions();
        expect(app).toHaveLength(13);

        const named = app
            .map(fn => fn.Properties?.FunctionName)
            .filter((n): n is string => typeof n === 'string' && n.startsWith('biztrack-'));

        expect(named.sort()).toEqual([
            'biztrack-batches',
            'biztrack-clients',
            'biztrack-dashboard',
            'biztrack-health',
            'biztrack-post-confirmation',
            'biztrack-products',
            'biztrack-purge-accounts',
            'biztrack-stock-movements',
            'biztrack-tasks',
            'biztrack-user',
            'biztrack-whatsapp-scheduler',
            'biztrack-whatsapp-test',
        ]);
        // 12 named + 1 unnamed (invoices) = 13.
        expect(named).toHaveLength(12);
    });
});

/**
 * Our application Lambda functions — every one built from the shared asset,
 * identified by its `dist/<file>.handler`. This deliberately EXCLUDES CDK's own
 * S3AutoDeleteObjects helper (handler `index.handler`), and unlike a name-based
 * filter it still catches functions with no hardcoded FunctionName.
 */
const appFunctions = () =>
    Object.values(template.findResources('AWS::Lambda::Function'))
        .filter(fn => String(fn.Properties?.Handler ?? '').startsWith('dist/'));

describe('Lambda runtime', () => {
    // AWS blocks UPDATES to functions on a deprecated runtime, so drifting past
    // a deprecation date is not a warning — it is the day you can no longer
    // deploy a fix. These assert the property that matters (nothing deprecated,
    // nothing inconsistent) rather than pinning a version string that has to be
    // hand-edited on every bump, which is what the previous test did.
    //
    // Dates from https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
    // (checked 2026-07-23). Add to this list as runtimes reach deprecation.
    const DEPRECATED = [
        'nodejs14.x', 'nodejs16.x', 'nodejs18.x',
        'nodejs20.x',   // deprecated 2026-04-30, updates blocked 2027-03-03
    ];

    // Identified by handler, not name — so the unnamed invoices function is
    // covered here too. A name-based filter would silently skip it, and a
    // function on a deprecated runtime that no test checks is the whole failure
    // this block exists to prevent.
    const appRuntimes = () => appFunctions().map(fn => String(fn.Properties?.Runtime));

    test('no function runs a deprecated runtime', () => {
        const offenders = appRuntimes().filter(r => DEPRECATED.includes(r));
        expect(offenders).toEqual([]);
    });

    test('every function shares one runtime — no accidental drift', () => {
        const distinct = [...new Set(appRuntimes())];
        expect(distinct).toHaveLength(1);
    });

    test('all 13 app functions are covered by that check', () => {
        expect(appRuntimes()).toHaveLength(13);
    });
});

describe('inventory API routes', () => {
    // Resource path -> the methods that must exist on it.
    const expected: [string, string[]][] = [
        ['products',      ['GET', 'POST']],
        ['bulk',          ['POST', 'DELETE']],
        ['{id}',          ['GET', 'PUT', 'DELETE']],
        ['batches',       ['GET']],
        ['{productId}',   []],
        ['{expiry}',      ['PUT']],
        ['write-off',     ['POST']],
        ['stock-movements', ['GET']],
    ];

    test.each(expected.filter(([, methods]) => methods.length > 0))(
        '/%s exposes %s', (pathPart, methods) => {
            const resources = template.findResources('AWS::ApiGateway::Resource', {
                Properties: { PathPart: pathPart },
            });
            expect(Object.keys(resources).length).toBeGreaterThan(0);

            for (const method of methods) {
                // Every inventory method is Cognito-authorized, like the rest.
                template.hasResourceProperties('AWS::ApiGateway::Method', {
                    HttpMethod:        method,
                    AuthorizationType: 'COGNITO_USER_POOLS',
                });
            }
        },
    );

    test('write-off hangs off /batches/{productId}/{expiry}', () => {
        const writeOff = Object.values(template.findResources('AWS::ApiGateway::Resource', {
            Properties: { PathPart: 'write-off' },
        }))[0];
        const expiry = Object.entries(template.findResources('AWS::ApiGateway::Resource', {
            Properties: { PathPart: '{expiry}' },
        }))[0];
        expect(writeOff.Properties.ParentId.Ref).toBe(expiry[0]);
    });

    test('/stock-movements is GET-only — no write verb is routed', () => {
        const resource = Object.entries(template.findResources('AWS::ApiGateway::Resource', {
            Properties: { PathPart: 'stock-movements' },
        }))[0];
        const methods = Object.values(template.findResources('AWS::ApiGateway::Method'))
            .filter(m => m.Properties.ResourceId?.Ref === resource[0])
            .map(m => m.Properties.HttpMethod);

        expect(methods.sort()).toEqual(['GET', 'OPTIONS']);   // OPTIONS is CORS preflight
    });
});

describe('invoice API routes', () => {
    // Resolve a resource id by walking its PathPart chain, so the `{id}` under
    // /invoices is never confused with the `{id}` under /products or /clients —
    // each of those synthesises the same PathPart. The first segment
    // (`invoices`) is unique at the API root, so it anchors the walk; every
    // deeper segment must additionally sit under the previous logical id.
    const resourceIdByPath = (segments: string[]): string => {
        let currentId = '';
        segments.forEach((seg, i) => {
            const matches = Object.entries(template.findResources('AWS::ApiGateway::Resource', {
                Properties: { PathPart: seg },
            }));
            const entry = i === 0
                ? matches[0]
                : matches.find(([, r]) => r.Properties.ParentId?.Ref === currentId);
            if (!entry) throw new Error(`no resource "${seg}" under /${segments.slice(0, i + 1).join('/')}`);
            currentId = entry[0];
        });
        return currentId;
    };

    const methodsOn = (resourceId: string): string[] =>
        Object.values(template.findResources('AWS::ApiGateway::Method'))
            .filter(m => m.Properties.ResourceId?.Ref === resourceId)
            .map(m => String(m.Properties.HttpMethod))
            .sort();

    test('/invoices exposes GET + POST (+ CORS OPTIONS)', () => {
        expect(methodsOn(resourceIdByPath(['invoices']))).toEqual(['GET', 'OPTIONS', 'POST']);
    });

    test('/invoices/{id} exposes GET + PUT + DELETE', () => {
        expect(methodsOn(resourceIdByPath(['invoices', '{id}']))).toEqual(['DELETE', 'GET', 'OPTIONS', 'PUT']);
    });

    test('/invoices/{id}/finalize is POST-only', () => {
        expect(methodsOn(resourceIdByPath(['invoices', '{id}', 'finalize']))).toEqual(['OPTIONS', 'POST']);
    });

    test('/invoices/{id}/cancel is POST-only', () => {
        expect(methodsOn(resourceIdByPath(['invoices', '{id}', 'cancel']))).toEqual(['OPTIONS', 'POST']);
    });

    test('every invoice method is Cognito-authorized', () => {
        for (const path of [['invoices'], ['invoices', '{id}'], ['invoices', '{id}', 'finalize'], ['invoices', '{id}', 'cancel']]) {
            const id = resourceIdByPath(path);
            const authTypes = Object.values(template.findResources('AWS::ApiGateway::Method'))
                .filter(m => m.Properties.ResourceId?.Ref === id && m.Properties.HttpMethod !== 'OPTIONS')
                .map(m => m.Properties.AuthorizationType);
            expect(authTypes.every(t => t === 'COGNITO_USER_POOLS')).toBe(true);
            expect(authTypes.length).toBeGreaterThan(0);
        }
    });

    test('all four invoice methods route to the same one Lambda', () => {
        // One handler owns create/list/get/update/finalize/cancel/delete; the
        // routes must not accidentally fan out to different functions.
        const invoiceIds = new Set([
            resourceIdByPath(['invoices']),
            resourceIdByPath(['invoices', '{id}']),
            resourceIdByPath(['invoices', '{id}', 'finalize']),
            resourceIdByPath(['invoices', '{id}', 'cancel']),
        ]);
        const integrationUris = Object.values(template.findResources('AWS::ApiGateway::Method'))
            .filter(m => invoiceIds.has(m.Properties.ResourceId?.Ref) && m.Properties.HttpMethod !== 'OPTIONS')
            .map(m => JSON.stringify(m.Properties.Integration?.Uri));
        expect(new Set(integrationUris).size).toBe(1);
    });
});

describe('throttling', () => {
    const methodSettings = () => {
        const stage = Object.values(template.findResources('AWS::ApiGateway::Stage'))[0];
        return stage.Properties.MethodSettings as {
            HttpMethod: string; ResourcePath: string;
            ThrottlingRateLimit: number; ThrottlingBurstLimit: number;
        }[];
    };

    test('POST /products/bulk is capped like /clients/bulk', () => {
        const bulk = methodSettings().find(s => s.ResourcePath === '/~1products~1bulk' && s.HttpMethod === 'POST');
        expect(bulk).toBeDefined();
        expect(bulk!.ThrottlingRateLimit).toBe(5);
        expect(bulk!.ThrottlingBurstLimit).toBe(10);
    });

    test('POST /invoices carries the same 5/10 cap as the bulk writes', () => {
        // The invoice create is a transaction; it belongs in the same weight
        // class as the bulk imports, not the default stage limit.
        const invoices = methodSettings().find(s => s.ResourcePath === '/~1invoices' && s.HttpMethod === 'POST');
        expect(invoices).toBeDefined();
        expect(invoices!.ThrottlingRateLimit).toBe(5);
        expect(invoices!.ThrottlingBurstLimit).toBe(10);
    });

    test('finalize and cancel are NOT separately throttled — one-per-invoice, no fan-out', () => {
        const paths = methodSettings().map(s => s.ResourcePath);
        expect(paths).not.toContain('/~1invoices~1{id}~1finalize');
        expect(paths).not.toContain('/~1invoices~1{id}~1cancel');
    });
});

describe('health endpoint (AI-EOS platform contract §1)', () => {
    test('/health exists', () => {
        const resources = template.findResources('AWS::ApiGateway::Resource', {
            Properties: { PathPart: 'health' },
        });
        expect(Object.keys(resources).length).toBe(1);
    });

    // HEAD as well as GET: API Gateway routes on the exact (resource, method)
    // pair and never synthesizes HEAD from GET, so without this a monitor or
    // load balancer sending HEAD gets a 403 that means "no such route".
    test.each(['GET', 'HEAD'])(
        '%s /health is UNAUTHENTICATED — a token would defeat the endpoint',
        (verb) => {
            const resource = Object.entries(template.findResources('AWS::ApiGateway::Resource', {
                Properties: { PathPart: 'health' },
            }))[0];

            const methods = Object.values(template.findResources('AWS::ApiGateway::Method'))
                .filter(m => m.Properties.ResourceId?.Ref === resource[0])
                .filter(m => m.Properties.HttpMethod === verb);

            expect(methods).toHaveLength(1);
            expect(methods[0].Properties.AuthorizationType).toBe('NONE');
            expect(methods[0].Properties.AuthorizerId).toBeUndefined();
        },
    );

    test('GET and HEAD on /health are the ONLY unauthenticated methods in the API', () => {
        // Guards the inverse risk: a future route quietly shipping without the
        // Cognito authorizer. OPTIONS is the CORS preflight and is always NONE.
        const healthId = Object.keys(template.findResources('AWS::ApiGateway::Resource', {
            Properties: { PathPart: 'health' },
        }))[0];

        const open = Object.values(template.findResources('AWS::ApiGateway::Method'))
            .filter(m => m.Properties.AuthorizationType === 'NONE')
            .filter(m => m.Properties.HttpMethod !== 'OPTIONS');

        // Exactly these two verbs, and nothing else, anywhere in the API.
        // Sorted because resource iteration order is not guaranteed.
        expect(open.map(m => m.Properties.HttpMethod).sort()).toEqual(['GET', 'HEAD']);

        // ...and BOTH of them on /health. This half is new: the previous version
        // only checked the verb, so an unauthenticated GET on any other resource
        // would have passed.
        for (const m of open) expect(m.Properties.ResourceId.Ref).toBe(healthId);
    });

    test('runs on its own short-timeout, low-memory function', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'biztrack-health',
            Handler:      'dist/health.handler',
            Timeout:      5,
            MemorySize:   128,
        });
    });

    test('HEALTH_TOKEN defaults to empty, so detail cannot leak by default', () => {
        const fn = Object.values(template.findResources('AWS::Lambda::Function', {
            Properties: { FunctionName: 'biztrack-health' },
        }))[0];
        expect(fn.Properties.Environment.Variables.HEALTH_TOKEN).toBe('');
    });
});

describe('CloudFront security headers', () => {
    test('a response headers policy is attached to the default behavior', () => {
        const dist = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0];
        expect(dist.Properties.DistributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId)
            .toBeDefined();
    });

    test('sets HSTS, nosniff, referrer policy and frame denial', () => {
        template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
            ResponseHeadersPolicyConfig: Match.objectLike({
                SecurityHeadersConfig: Match.objectLike({
                    StrictTransportSecurity: Match.objectLike({
                        AccessControlMaxAgeSec: 31536000,
                        IncludeSubdomains:      true,
                        Preload:                false,
                        Override:               true,
                    }),
                    ContentTypeOptions: { Override: true },
                    ReferrerPolicy: Match.objectLike({
                        ReferrerPolicy: 'strict-origin-when-cross-origin',
                    }),
                    FrameOptions: Match.objectLike({ FrameOption: 'DENY' }),
                }),
            }),
        });
    });

    test('no CSP yet — it is deferred deliberately, not forgotten (FU-EOS-3)', () => {
        const policy = Object.values(
            template.findResources('AWS::CloudFront::ResponseHeadersPolicy'),
        )[0];
        expect(policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig
            .ContentSecurityPolicy).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// FU-EOS-6. Before this, the account had zero alarms - which is how the
// WhatsApp scheduler failed 4,320 times a day for 31 days unseen. These tests
// exist to stop the specific ways this could silently become decorative again.
// ---------------------------------------------------------------------------
describe('Monitoring', () => {
    const alarms = () => template.findResources('AWS::CloudWatch::Alarm');
    const byName = (name: string) =>
        Object.values(alarms()).find(a => a.Properties.AlarmName === name);

    test('there is exactly one alert topic, and it is named for humans', () => {
        template.resourceCountIs('AWS::SNS::Topic', 1);
        template.hasResourceProperties('AWS::SNS::Topic', {
            TopicName:   'biztrack-alerts',
            DisplayName: 'Biztrack alerts',
        });
    });

    // The whole of Decision A1. The repo is public, so no address may appear
    // here; and a `-c alertEmail=` context value would be DELETED by the next
    // deploy that forgot the flag, silently restoring the blindness. The
    // subscription is made out of band and guarded by verify.sh instead.
    test('NO subscription is declared in the stack', () => {
        template.resourceCountIs('AWS::SNS::Subscription', 0);
    });

    test('all five alarms exist, and no others crept in', () => {
        expect(Object.values(alarms()).map(a => a.Properties.AlarmName).sort()).toEqual([
            'biztrack-api-5xx',
            'biztrack-dynamodb-throttles',
            'biztrack-lambda-errors',
            'biztrack-lambda-throttles',
            'biztrack-purge-not-running',
        ]);
    });

    // The failure this section exists to prevent, in test form: an alarm that
    // fires into nothing is worse than no alarm, because the console looks fine.
    test('every alarm notifies the topic on BOTH alarm and recovery', () => {
        for (const a of Object.values(alarms())) {
            expect(a.Properties.AlarmActions).toHaveLength(1);
            expect(a.Properties.OKActions).toHaveLength(1);
            expect(a.Properties.AlarmActions[0]).toEqual(a.Properties.OKActions[0]);
        }
    });

    test('every alarm states what to do about it', () => {
        for (const a of Object.values(alarms())) {
            expect(a.Properties.AlarmDescription.length).toBeGreaterThan(60);
        }
    });

    // BR-BIZ-E04. Non-ASCII in an AWS description has broken a deploy here before.
    test('no alarm name or description carries a non-ASCII character', () => {
        for (const a of Object.values(alarms())) {
            expect(a.Properties.AlarmName).toMatch(/^[\x20-\x7E]+$/);
            expect(a.Properties.AlarmDescription).toMatch(/^[\x20-\x7E]+$/);
        }
    });

    test('API 5XX alarm is scoped by ApiName ONLY, never by Stage', () => {
        const a = byName('biztrack-api-5xx')!;
        expect(a.Properties.Namespace).toBe('AWS/ApiGateway');
        expect(a.Properties.MetricName).toBe('5XXError');
        expect(a.Properties.Dimensions).toHaveLength(1);
        expect(a.Properties.Dimensions[0].Name).toBe('ApiName');
    });

    // Undimensioned on purpose: this is the only alarm that sees EventBridge
    // targets, the Cognito trigger and direct invokes. Adding a FunctionName
    // dimension here would re-blind the app to the WhatsApp class of failure.
    test.each([
        ['biztrack-lambda-errors',    'Errors'],
        ['biztrack-lambda-throttles', 'Throttles'],
    ])('%s watches ALL Lambdas, with no dimensions', (name, metric) => {
        const a = byName(name)!;
        expect(a.Properties.Namespace).toBe('AWS/Lambda');
        expect(a.Properties.MetricName).toBe(metric);
        expect(a.Properties.Dimensions).toBeUndefined();
        expect(a.Properties.Statistic).toBe('Sum');
        expect(a.Properties.Period).toBe(300);
        expect(a.Properties.Threshold).toBe(1);
    });

    // CDK marks table.metricThrottledRequests() "@deprecated ... returns an
    // invalid metric": ThrottledRequests only publishes WITH an Operation
    // dimension, so a TableName-only alarm on it never leaves INSUFFICIENT_DATA.
    test('DynamoDB throttle alarm uses throttle EVENTS, not ThrottledRequests', () => {
        const a = byName('biztrack-dynamodb-throttles')!;
        const used = JSON.stringify(a.Properties.Metrics);
        expect(used).toContain('ReadThrottleEvents');
        expect(used).toContain('WriteThrottleEvents');
        expect(used).not.toContain('ThrottledRequests');
    });

    test('the four "something broke" alarms treat no data as healthy', () => {
        for (const name of [
            'biztrack-api-5xx', 'biztrack-lambda-errors',
            'biztrack-lambda-throttles', 'biztrack-dynamodb-throttles',
        ]) {
            expect(byName(name)!.Properties.TreatMissingData).toBe('notBreaching');
        }
    });

    // The one alarm that inverts it: here absence IS the failure. 6h windows,
    // five of them, because a 24h period aligns to 00:00 UTC and the job runs at
    // 03:00 - which would alarm every morning. One run/day leaves at most THREE
    // consecutive empty 6h windows, so five cannot false-positive.
    test('purge alarm fires on ABSENCE, over a window a daily job cannot trip', () => {
        const a = byName('biztrack-purge-not-running')!;
        expect(a.Properties.MetricName).toBe('Invocations');
        expect(a.Properties.ComparisonOperator).toBe('LessThanThreshold');
        expect(a.Properties.Threshold).toBe(1);
        expect(a.Properties.Period).toBe(21600);
        expect(a.Properties.EvaluationPeriods).toBe(5);
        expect(a.Properties.DatapointsToAlarm).toBe(5);
        expect(a.Properties.TreatMissingData).toBe('breaching');
    });

    test('one dashboard exists, named biztrack', () => {
        template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
        template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
            DashboardName: 'biztrack',
        });
    });

    // AWS/Billing publishes ONLY in us-east-1. A widget left in ap-south-1
    // renders permanently empty, which reads as zero spend rather than no data.
    test('the billing widget is pinned to us-east-1', () => {
        const body = JSON.stringify(
            Object.values(template.findResources('AWS::CloudWatch::Dashboard'))[0]
                .Properties.DashboardBody,
        );
        expect(body).toContain('EstimatedCharges');
        expect(body).toContain('us-east-1');
    });
});

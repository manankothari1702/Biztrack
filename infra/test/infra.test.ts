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

    test('the stack now declares 11 biztrack functions', () => {
        // 8 pre-existing + products + batches + stockMovements. Counted by name
        // rather than resource type: CDK also synthesises its own unnamed helper
        // (S3AutoDeleteObjects, from autoDeleteObjects on the site bucket), and a
        // raw resourceCountIs would break whenever CDK adds another internal one.
        const named = Object.values(template.findResources('AWS::Lambda::Function'))
            .map(fn => fn.Properties?.FunctionName)
            .filter((n): n is string => typeof n === 'string' && n.startsWith('biztrack-'));

        expect(named.sort()).toEqual([
            'biztrack-batches',
            'biztrack-clients',
            'biztrack-dashboard',
            'biztrack-post-confirmation',
            'biztrack-products',
            'biztrack-purge-accounts',
            'biztrack-stock-movements',
            'biztrack-tasks',
            'biztrack-user',
            'biztrack-whatsapp-scheduler',
            'biztrack-whatsapp-test',
        ]);
    });
});

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

    const biztrackRuntimes = () =>
        Object.values(template.findResources('AWS::Lambda::Function'))
            .filter(fn => String(fn.Properties?.FunctionName ?? '').startsWith('biztrack-'))
            .map(fn => String(fn.Properties?.Runtime));

    test('no function runs a deprecated runtime', () => {
        const offenders = biztrackRuntimes().filter(r => DEPRECATED.includes(r));
        expect(offenders).toEqual([]);
    });

    test('every function shares one runtime — no accidental drift', () => {
        const distinct = [...new Set(biztrackRuntimes())];
        expect(distinct).toHaveLength(1);
    });

    test('all 11 are covered by that check', () => {
        expect(biztrackRuntimes()).toHaveLength(11);
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

describe('throttling', () => {
    test('POST /products/bulk is capped like /clients/bulk', () => {
        const stage = Object.values(template.findResources('AWS::ApiGateway::Stage'))[0];
        const settings = stage.Properties.MethodSettings as {
            HttpMethod: string; ResourcePath: string;
            ThrottlingRateLimit: number; ThrottlingBurstLimit: number;
        }[];

        const bulk = settings.find(s => s.ResourcePath === '/~1products~1bulk' && s.HttpMethod === 'POST');
        expect(bulk).toBeDefined();
        expect(bulk!.ThrottlingRateLimit).toBe(2);
        expect(bulk!.ThrottlingBurstLimit).toBe(5);
    });
});

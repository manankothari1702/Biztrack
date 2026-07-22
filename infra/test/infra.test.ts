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

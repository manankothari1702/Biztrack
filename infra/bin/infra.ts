#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { BiztrackStack } from '../lib/biztrack-stack';

const app = new cdk.App();

const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1',
};

// Production. The stack id and every resource name inside it are unchanged from
// before dev existed, so deploying this cannot rename or replace anything live.
new BiztrackStack(app, 'BiztrackStack', {
    env,
    envName: 'prod',
    description: 'Biztrack CRM - Cognito + DynamoDB + Lambda + API Gateway + S3/CloudFront',
});

// Development. Its own table, user pool, functions, API and bucket, all suffixed
// with -dev. Empty by design and never seeded. Costs almost nothing while idle:
// DynamoDB is pay-per-request and Lambda scales to zero.
//
// Deploy explicitly, one at a time, so a careless `cdk deploy` cannot touch both:
//   npx cdk deploy BiztrackStack-dev
new BiztrackStack(app, 'BiztrackStack-dev', {
    env,
    envName: 'dev',
    description: 'Biztrack CRM development environment - empty, for testing only',
});

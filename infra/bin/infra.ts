#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { BiztrackStack } from '../lib/biztrack-stack';

const app = new cdk.App();
new BiztrackStack(app, 'BiztrackStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1',
    },
    description: 'Biztrack CRM - Cognito + DynamoDB + Lambda + API Gateway + S3/CloudFront',
});

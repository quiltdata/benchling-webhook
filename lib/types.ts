import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";

export interface StateMachineProps {
    bucket: s3.IBucket;
    prefix: string;
    queueName: string;
    region: string;
    account: string;
    benchlingConnection: events.CfnConnection;
    benchlingTenant: string;
    exportProcessor: lambda.IFunction;
}

export interface ProcessExportEvent {
    downloadURL: string;
    packageName: string;
    registry: string;
}

export interface ExportStatus {
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
    downloadURL?: string;
}

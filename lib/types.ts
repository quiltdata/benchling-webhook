import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";

export interface BaseStateMachineProps {
    bucket: s3.IBucket;
    prefix: string;
    benchlingConnection: events.CfnConnection;
}

export interface WebhookStateMachineProps extends BaseStateMachineProps {
    queueName: string;
    region: string;
    account: string;
    benchlingTenant: string;
    exportProcessor: lambda.IFunction;
    quiltCatalog?: string;
}

export interface PackageEntryStateMachineProps extends BaseStateMachineProps {
    queueName: string;
    region: string;
    account: string;
    exportProcessor: lambda.IFunction;
}

export interface ProcessExportEvent {
    downloadURL: string;
    packageName: string;
    registry: string;
}

export interface ExportStatus {
    status: "RUNNING" | "SUCCEEDED" | "FAILED";
    downloadURL?: string;
}

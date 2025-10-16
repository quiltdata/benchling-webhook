import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";

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
    quiltCatalog?: string;
    webhookAllowList?: string;
}

export interface PackagingStateMachineProps extends BaseStateMachineProps {
    queueName: string;
    region: string;
    account: string;
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

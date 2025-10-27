import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";

export interface EcrRepositoryProps {
    readonly repositoryName: string;
    readonly publicReadAccess?: boolean;
}

/**
 * ECR Repository construct for storing Docker images
 * Supports both private and public access configurations
 */
export class EcrRepository extends Construct {
    public readonly repository: ecr.Repository;
    public readonly repositoryUri: string;

    constructor(scope: Construct, id: string, props: EcrRepositoryProps) {
        super(scope, id);

        // Create ECR repository
        this.repository = new ecr.Repository(this, "Repository", {
            repositoryName: props.repositoryName,
            // Keep images when stack is deleted
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            // Automatically scan images on push for security vulnerabilities
            imageScanOnPush: true,
            // Lifecycle policy to keep last 10 images
            lifecycleRules: [
                {
                    description: "Keep last 10 images",
                    maxImageCount: 10,
                    rulePriority: 1,
                },
            ],
        });

        // If public read access is enabled, add repository policy
        if (props.publicReadAccess) {
            this.repository.addToResourcePolicy(
                new cdk.aws_iam.PolicyStatement({
                    effect: cdk.aws_iam.Effect.ALLOW,
                    principals: [new cdk.aws_iam.AnyPrincipal()],
                    actions: [
                        "ecr:GetDownloadUrlForLayer",
                        "ecr:BatchGetImage",
                        "ecr:BatchCheckLayerAvailability",
                    ],
                }),
            );
        }

        this.repositoryUri = this.repository.repositoryUri;

        // Output the repository information
        new cdk.CfnOutput(this, "RepositoryUri", {
            value: this.repository.repositoryUri,
            description: "ECR Repository URI",
            exportName: `${props.repositoryName}-RepositoryUri`,
        });

        new cdk.CfnOutput(this, "RepositoryArn", {
            value: this.repository.repositoryArn,
            description: "ECR Repository ARN",
            exportName: `${props.repositoryName}-RepositoryArn`,
        });
    }
}

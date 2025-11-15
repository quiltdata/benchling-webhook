/**
 * Unit tests for Stack Parameter Update utility
 *
 * Tests safe parameter updates with CloudFormation stacks
 */

// Mock chalk to avoid ESM issues in Jest
jest.mock("chalk", () => ({
  default: {
    yellow: (str: string) => str,
    green: (str: string) => str,
    red: (str: string) => str,
    cyan: (str: string) => str,
    bold: (str: string) => str,
  },
  yellow: (str: string) => str,
  green: (str: string) => str,
  red: (str: string) => str,
  cyan: (str: string) => str,
  bold: (str: string) => str,
}));

import { mockClient } from "aws-sdk-client-mock";
import {
  CloudFormationClient,
  UpdateStackCommand,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  updateStackParameter,
  getStackParameter,
  StackParameterUpdateOptions,
} from "../../../lib/utils/stack-parameter-update";

describe("updateStackParameter", () => {
  const cfnMock = mockClient(CloudFormationClient);

  beforeEach(() => {
    cfnMock.reset();
  });

  describe("successful updates", () => {
    it("should update single parameter with UsePreviousValue for others", async () => {
      // Mock DescribeStacks
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "QueueUrl", ParameterValue: "https://sqs.us-east-1.amazonaws.com/123456789012/old-queue" },
              { ParameterKey: "ImageTag", ParameterValue: "v0.7.0" },
              { ParameterKey: "LogLevel", ParameterValue: "INFO" },
            ],
            Capabilities: ["CAPABILITY_IAM"],
          },
        ],
      });

      // Mock UpdateStack
      cfnMock.on(UpdateStackCommand).resolves({
        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "QueueUrl",
        parameterValue: "https://sqs.us-east-1.amazonaws.com/123456789012/new-queue",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(true);
      expect(result.stackId).toBe("arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123");
      expect(result.error).toBeUndefined();

      // Verify UpdateStackCommand was called with correct parameters
      const updateCalls = cfnMock.commandCalls(UpdateStackCommand);
      expect(updateCalls.length).toBe(1);

      const updateCall = updateCalls[0];
      expect(updateCall.args[0].input.StackName).toBe("BenchlingWebhookStack");
      expect(updateCall.args[0].input.UsePreviousTemplate).toBe(true);
      expect(updateCall.args[0].input.Capabilities).toEqual(["CAPABILITY_IAM"]);

      const parameters = updateCall.args[0].input.Parameters;
      expect(parameters).toHaveLength(3);

      // Updated parameter should have new value
      const queueUrlParam = parameters?.find((p) => p.ParameterKey === "QueueUrl");
      expect(queueUrlParam?.ParameterValue).toBe("https://sqs.us-east-1.amazonaws.com/123456789012/new-queue");
      expect(queueUrlParam?.UsePreviousValue).toBeUndefined();

      // Other parameters should use previous values
      const imageTagParam = parameters?.find((p) => p.ParameterKey === "ImageTag");
      expect(imageTagParam?.UsePreviousValue).toBe(true);
      expect(imageTagParam?.ParameterValue).toBeUndefined();

      const logLevelParam = parameters?.find((p) => p.ParameterKey === "LogLevel");
      expect(logLevelParam?.UsePreviousValue).toBe(true);
      expect(logLevelParam?.ParameterValue).toBeUndefined();
    });

    it("should handle 'No updates are to be performed' error gracefully", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "QueueUrl", ParameterValue: "https://sqs.us-east-1.amazonaws.com/123456789012/queue" },
            ],
            Capabilities: [],
          },
        ],
      });

      // Simulate CloudFormation "no changes" error
      cfnMock.on(UpdateStackCommand).rejects({
        name: "ValidationError",
        message: "No updates are to be performed.",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "QueueUrl",
        parameterValue: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
      };

      const result = await updateStackParameter(options);

      // Should treat as success, not an error
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.stackId).toBeUndefined();
    });

    it("should preserve stack capabilities", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "Param1", ParameterValue: "value1" },
            ],
            Capabilities: ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM"],
          },
        ],
      });

      cfnMock.on(UpdateStackCommand).resolves({
        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "Param1",
        parameterValue: "newValue1",
      };

      await updateStackParameter(options);

      const updateCalls = cfnMock.commandCalls(UpdateStackCommand);
      const capabilities = updateCalls[0].args[0].input.Capabilities;
      expect(capabilities).toEqual(["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM"]);
    });

    it("should support AWS profile credentials", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "Param1", ParameterValue: "value1" },
            ],
            Capabilities: [],
          },
        ],
      });

      cfnMock.on(UpdateStackCommand).resolves({
        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "Param1",
        parameterValue: "newValue1",
        awsProfile: "production",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(true);
      // Note: Testing actual profile loading would require real AWS credentials
      // This test verifies the code accepts the profile parameter
    });

    it("should handle stack with no parameters", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [],
            Capabilities: [],
          },
        ],
      });

      cfnMock.on(UpdateStackCommand).resolves({
        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "NewParam",
        parameterValue: "newValue",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(true);
    });

    it("should update parameter in different region", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "Region", ParameterValue: "eu-west-1" },
            ],
            Capabilities: [],
          },
        ],
      });

      cfnMock.on(UpdateStackCommand).resolves({
        StackId: "arn:aws:cloudformation:eu-west-1:123456789012:stack/BenchlingWebhookStack/abc-123",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:eu-west-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "eu-west-1",
        parameterKey: "Region",
        parameterValue: "eu-west-2",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should throw on invalid stack ARN format", async () => {
      const options: StackParameterUpdateOptions = {
        stackArn: "not-a-valid-arn",
        region: "us-east-1",
        parameterKey: "QueueUrl",
        parameterValue: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid stack ARN format");
      expect(result.stackId).toBeUndefined();
    });

    it("should handle stack not found error", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [],
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/NonExistentStack/abc-123",
        region: "us-east-1",
        parameterKey: "QueueUrl",
        parameterValue: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Stack not found");
    });

    it("should handle AWS SDK errors properly", async () => {
      cfnMock.on(DescribeStacksCommand).rejects({
        name: "AccessDenied",
        message: "User not authorized to describe stack",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "QueueUrl",
        parameterValue: "https://sqs.us-east-1.amazonaws.com/123456789012/queue",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain("User not authorized to describe stack");
    });

    it("should handle UpdateStack failures", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "QueueUrl", ParameterValue: "old-value" },
            ],
            Capabilities: [],
          },
        ],
      });

      cfnMock.on(UpdateStackCommand).rejects({
        name: "ValidationError",
        message: "Invalid parameter value",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "QueueUrl",
        parameterValue: "invalid-value",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid parameter value");
    });

    it("should handle malformed ARN with missing stack name", async () => {
      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:something/else",
        region: "us-east-1",
        parameterKey: "QueueUrl",
        parameterValue: "value",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid stack ARN format");
    });

    it("should handle stack in UPDATE_IN_PROGRESS state", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_IN_PROGRESS",
            Parameters: [
              { ParameterKey: "Param1", ParameterValue: "value1" },
            ],
            Capabilities: [],
          },
        ],
      });

      cfnMock.on(UpdateStackCommand).rejects({
        name: "ValidationError",
        message: "Stack is in UPDATE_IN_PROGRESS state",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "Param1",
        parameterValue: "newValue1",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain("UPDATE_IN_PROGRESS");
    });

    it("should handle network errors", async () => {
      cfnMock.on(DescribeStacksCommand).rejects({
        name: "NetworkingError",
        message: "Connection timeout",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "QueueUrl",
        parameterValue: "value",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("should handle stack with undefined parameters array", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            // Parameters: undefined (not provided)
            Capabilities: [],
          },
        ],
      });

      cfnMock.on(UpdateStackCommand).resolves({
        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "NewParam",
        parameterValue: "value",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(true);
    });

    it("should handle stack with undefined capabilities", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "Param1", ParameterValue: "value1" },
            ],
            // Capabilities: undefined (not provided)
          },
        ],
      });

      cfnMock.on(UpdateStackCommand).resolves({
        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "Param1",
        parameterValue: "newValue1",
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(true);
    });

    it("should handle very long parameter values", async () => {
      const longValue = "x".repeat(4096);

      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "LongParam", ParameterValue: "short" },
            ],
            Capabilities: [],
          },
        ],
      });

      cfnMock.on(UpdateStackCommand).resolves({
        StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
      });

      const options: StackParameterUpdateOptions = {
        stackArn: "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        region: "us-east-1",
        parameterKey: "LongParam",
        parameterValue: longValue,
      };

      const result = await updateStackParameter(options);

      expect(result.success).toBe(true);
    });
  });
});

describe("getStackParameter", () => {
  const cfnMock = mockClient(CloudFormationClient);

  beforeEach(() => {
    cfnMock.reset();
  });

  describe("successful retrieval", () => {
    it("should retrieve parameter value successfully", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "QueueUrl", ParameterValue: "https://sqs.us-east-1.amazonaws.com/123456789012/queue" },
              { ParameterKey: "ImageTag", ParameterValue: "v0.7.0" },
            ],
          },
        ],
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        "us-east-1",
        "QueueUrl"
      );

      expect(value).toBe("https://sqs.us-east-1.amazonaws.com/123456789012/queue");
    });

    it("should return undefined for non-existent parameter", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "QueueUrl", ParameterValue: "https://sqs.us-east-1.amazonaws.com/123456789012/queue" },
            ],
          },
        ],
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        "us-east-1",
        "NonExistentParam"
      );

      expect(value).toBeUndefined();
    });

    it("should support AWS profile credentials", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "Param1", ParameterValue: "value1" },
            ],
          },
        ],
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        "us-east-1",
        "Param1",
        "production"
      );

      expect(value).toBe("value1");
    });

    it("should handle stack with no parameters", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [],
          },
        ],
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        "us-east-1",
        "AnyParam"
      );

      expect(value).toBeUndefined();
    });

    it("should handle stack with undefined parameters array", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            // Parameters: undefined
          },
        ],
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        "us-east-1",
        "AnyParam"
      );

      expect(value).toBeUndefined();
    });
  });

  describe("error handling with warnings", () => {
    it("should return undefined and warn on invalid stack ARN", async () => {
      // Capture console.warn
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      const value = await getStackParameter(
        "not-a-valid-arn",
        "us-east-1",
        "QueueUrl"
      );

      expect(value).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Could not get parameter QueueUrl")
      );

      warnSpy.mockRestore();
    });

    it("should return undefined when stack not found", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [],
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:us-east-1:123456789012:stack/NonExistentStack/abc-123",
        "us-east-1",
        "QueueUrl"
      );

      expect(value).toBeUndefined();
    });

    it("should handle AWS SDK errors with warning (not throw)", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      cfnMock.on(DescribeStacksCommand).rejects({
        name: "AccessDenied",
        message: "User not authorized",
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        "us-east-1",
        "QueueUrl"
      );

      expect(value).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Warning: Could not get parameter QueueUrl")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("User not authorized")
      );

      warnSpy.mockRestore();
    });

    it("should handle network errors gracefully", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      cfnMock.on(DescribeStacksCommand).rejects({
        name: "NetworkingError",
        message: "Connection timeout",
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        "us-east-1",
        "QueueUrl"
      );

      expect(value).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("should handle ValidationError gracefully", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      cfnMock.on(DescribeStacksCommand).rejects({
        name: "ValidationError",
        message: "Invalid stack name",
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:us-east-1:123456789012:stack/BadStack/abc-123",
        "us-east-1",
        "QueueUrl"
      );

      expect(value).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid stack name")
      );

      warnSpy.mockRestore();
    });
  });

  describe("edge cases", () => {
    it("should handle parameter with empty string value", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "EmptyParam", ParameterValue: "" },
            ],
          },
        ],
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        "us-east-1",
        "EmptyParam"
      );

      expect(value).toBe("");
    });

    it("should handle parameter with special characters", async () => {
      const specialValue = "https://example.com?param=value&other=123#anchor";

      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "SpecialParam", ParameterValue: specialValue },
            ],
          },
        ],
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:us-east-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        "us-east-1",
        "SpecialParam"
      );

      expect(value).toBe(specialValue);
    });

    it("should retrieve parameter from stack in different region", async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [
          {
            StackName: "BenchlingWebhookStack",
            CreationTime: new Date(),
            StackStatus: "UPDATE_COMPLETE",
            Parameters: [
              { ParameterKey: "RegionParam", ParameterValue: "eu-west-1" },
            ],
          },
        ],
      });

      const value = await getStackParameter(
        "arn:aws:cloudformation:eu-west-1:123456789012:stack/BenchlingWebhookStack/abc-123",
        "eu-west-1",
        "RegionParam"
      );

      expect(value).toBe("eu-west-1");
    });
  });
});

/**
 * Mock AWS Provider for testing
 *
 * Allows tests to simulate AWS API responses without actual AWS calls.
 */

import { IAwsProvider, StackDetails } from "../../lib/interfaces/aws-provider";

interface MockStack {
    region: string;
    resourceId: string;
    stackName: string;
    details: StackDetails;
}

export class MockAwsProvider implements IAwsProvider {
    private stacks: Map<string, MockStack> = new Map();
    private accountId: string | null = null;
    private throwOnFindStack = false;
    private throwOnGetDetails = false;
    private throwOnGetAccount = false;

    /**
     * Configure mock to return a stack for a given resource ID
     */
    mockStack(
        region: string,
        resourceId: string,
        stackName: string,
        details: StackDetails,
    ): void {
        this.stacks.set(`${region}:${resourceId}`, {
            region,
            resourceId,
            stackName,
            details,
        });
    }

    /**
     * Configure mock account ID
     */
    mockAccountId(accountId: string | null): void {
        this.accountId = accountId;
    }

    /**
     * Configure mock to throw errors
     */
    mockThrowOnFindStack(shouldThrow = true): void {
        this.throwOnFindStack = shouldThrow;
    }

    mockThrowOnGetDetails(shouldThrow = true): void {
        this.throwOnGetDetails = shouldThrow;
    }

    mockThrowOnGetAccount(shouldThrow = true): void {
        this.throwOnGetAccount = shouldThrow;
    }

    async findStackByResource(region: string, resourceId: string): Promise<string | null> {
        if (this.throwOnFindStack) {
            throw new Error("Mock AWS error: findStackByResource failed");
        }

        const stack = this.stacks.get(`${region}:${resourceId}`);
        return stack ? stack.stackName : null;
    }

    async getStackDetails(region: string, stackName: string): Promise<StackDetails> {
        if (this.throwOnGetDetails) {
            throw new Error("Mock AWS error: getStackDetails failed");
        }

        // Find by stackName in our mocked stacks
        for (const [, stack] of this.stacks) {
            if (stack.region === region && stack.stackName === stackName) {
                return stack.details;
            }
        }
        return { outputs: [], parameters: [] };
    }

    async getAccountId(): Promise<string | null> {
        if (this.throwOnGetAccount) {
            throw new Error("Mock AWS error: getAccountId failed");
        }
        return this.accountId;
    }

    /**
     * Reset all mocked data
     */
    reset(): void {
        this.stacks.clear();
        this.accountId = null;
        this.throwOnFindStack = false;
        this.throwOnGetDetails = false;
        this.throwOnGetAccount = false;
    }
}

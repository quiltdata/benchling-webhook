# Test Mocks

This directory contains mock implementations for testing.

## MockConfigStorage

An in-memory implementation of `IConfigStorage` that stores configuration in memory instead of the filesystem.

### Why?

Tests should **NEVER** touch the real XDG config directory (`~/.config/benchling-webhook/`). This prevents:
- Tests from overwriting real user configuration
- Tests from being dependent on filesystem state
- Tests from leaving artifacts behind
- Race conditions between parallel tests

### Usage

#### Option 1: Jest Module Mock (Recommended)

Use this when your code imports and instantiates `XDGConfig` directly:

```typescript
import { MockConfigStorage } from "../mocks";

// Mock the XDGConfig module to return our mock storage
jest.mock("../../lib/xdg-config", () => {
    const { MockConfigStorage } = require("../mocks/mock-config-storage");
    return {
        XDGConfig: jest.fn().mockImplementation(() => new MockConfigStorage()),
    };
});

describe("My Test Suite", () => {
    let mockStorage: MockConfigStorage;

    beforeEach(() => {
        mockStorage = new MockConfigStorage();

        // Update the mock to return our storage instance
        const { XDGConfig } = require("../../lib/xdg-config");
        XDGConfig.mockImplementation(() => mockStorage);
    });

    afterEach(() => {
        mockStorage.clear();
        jest.clearAllMocks();
    });

    test("does not touch filesystem", () => {
        // Your test code here
        // All XDGConfig operations will use mockStorage
    });
});
```

#### Option 2: Direct Usage

Use this when you have dependency injection or can pass the storage instance:

```typescript
import { MockConfigStorage } from "../mocks";

describe("My Test Suite", () => {
    let mockStorage: MockConfigStorage;

    beforeEach(() => {
        mockStorage = new MockConfigStorage();
    });

    afterEach(() => {
        mockStorage.clear();
    });

    test("direct mock usage", () => {
        mockStorage.writeProfile("test", {
            /* config */
        });
        const config = mockStorage.readProfile("test");
        expect(config).toBeDefined();
    });
});
```

### API

`MockConfigStorage` implements the full `IConfigStorage` interface:

- `readProfile(profile: string): ProfileConfig`
- `writeProfile(profile: string, config: ProfileConfig): void`
- `deleteProfile(profile: string): void`
- `listProfiles(): string[]`
- `profileExists(profile: string): boolean`
- `getDeployments(profile: string): DeploymentHistory`
- `recordDeployment(profile: string, deployment: DeploymentRecord): void`
- `getActiveDeployment(profile: string, stage: string): DeploymentRecord | null`
- `readProfileWithInheritance(profile: string, baseProfile?: string): ProfileConfig`
- `validateProfile(config: ProfileConfig): ValidationResult`
- `clear(): void` - Clears all stored data (test helper)

### Migration Guide

If you have existing tests that use filesystem operations:

**Before:**
```typescript
import { XDGConfig } from "../../lib/xdg-config";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

describe("Test", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));
        process.env.XDG_CONFIG_HOME = tempDir;
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true });
    });
});
```

**After:**
```typescript
import { MockConfigStorage } from "../mocks";

jest.mock("../../lib/xdg-config", () => {
    const { MockConfigStorage } = require("../mocks/mock-config-storage");
    return {
        XDGConfig: jest.fn().mockImplementation(() => new MockConfigStorage()),
    };
});

describe("Test", () => {
    let mockStorage: MockConfigStorage;

    beforeEach(() => {
        mockStorage = new MockConfigStorage();
        const { XDGConfig } = require("../../lib/xdg-config");
        XDGConfig.mockImplementation(() => mockStorage);
    });

    afterEach(() => {
        mockStorage.clear();
        jest.clearAllMocks();
    });
});
```

## Best Practices

1. **Always use mocks in tests** - Never let tests touch the real filesystem
2. **Clear mock state** - Call `mockStorage.clear()` in `afterEach()`
3. **Independent tests** - Each test should start with clean mock state
4. **No temp directories** - Don't create temp directories for config testing

## See Also

- [lib/interfaces/config-storage.ts](../../lib/interfaces/config-storage.ts) - Interface definition
- [test/sync-secrets.test.ts](../sync-secrets.test.ts) - Example usage

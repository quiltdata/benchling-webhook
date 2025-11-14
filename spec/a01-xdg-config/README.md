# XDG Configuration Refactoring Specification

## Overview

Refactor XDG configuration from interface-based abstraction to abstract base class with concrete implementations. This eliminates the coverage problem by ensuring all shared logic is exercised through both implementations, while allowing dedicated unit tests for filesystem-specific code.

## Problem Statement

**Current Issues:**
1. Low test coverage (64.34% vs 65% required) because `xdg-config.ts` filesystem code isn't exercised by tests using `MockConfigStorage`
2. Interface + separate mock implementation means shared logic exists in two places
3. No dedicated unit tests for `XDGConfig` filesystem operations

**Root Cause:**
Tests use `MockConfigStorage` for isolation, but this completely bypasses `XDGConfig` implementation, resulting in low coverage for the actual production code.

## Proposed Solution

Replace interface-based abstraction with abstract base class inheritance:

```
IConfigStorage (interface) - contract
    ↓
XDGBase (abstract class) - shared logic
    ↓                      ↓
XDGConfig              XDGTest
(filesystem)           (in-memory)
```

### Architecture

**1. IConfigStorage Interface**
- Retain as the public contract
- Defines all configuration operations
- Used for type declarations

**2. XDGBase Abstract Class**
- Implements IConfigStorage
- Contains ALL shared business logic:
  - Profile validation
  - Profile inheritance resolution
  - Deployment tracking
  - Error message generation
  - JSON schema validation
- Defines abstract methods for storage primitives:
  - `abstract readProfileRaw(profile: string): ProfileConfig`
  - `abstract writeProfileRaw(profile: string, config: ProfileConfig): void`
  - `abstract deleteProfileRaw(profile: string): void`
  - `abstract listProfilesRaw(): string[]`
  - `abstract profileExistsRaw(profile: string): boolean`
  - `abstract readDeploymentsRaw(profile: string): DeploymentHistory | null`
  - `abstract writeDeploymentsRaw(profile: string, history: DeploymentHistory): void`

**3. XDGConfig (Production)**
- Extends XDGBase
- Implements filesystem storage primitives
- Minimal code - only I/O operations
- Located: `lib/xdg-config.ts`

**4. XDGTest (Testing)**
- Extends XDGBase
- Implements in-memory storage primitives
- Uses Maps for storage
- Renamed from MockConfigStorage
- Located: `test/xdg-test.ts`

## Implementation Plan

### Phase 1: Extract Abstract Base Class

**File: `lib/xdg-base.ts`** (new)

1. Create abstract class implementing IConfigStorage
2. Move all business logic from XDGConfig to XDGBase:
   - `readProfile()` - calls abstract `readProfileRaw()`
   - `writeProfile()` - validates then calls abstract `writeProfileRaw()`
   - `deleteProfile()` - validates then calls abstract `deleteProfileRaw()`
   - `listProfiles()` - calls abstract `listProfilesRaw()`
   - `profileExists()` - calls abstract `profileExistsRaw()`
   - `getDeployments()` - calls abstract `readDeploymentsRaw()`
   - `recordDeployment()` - updates history then calls abstract `writeDeploymentsRaw()`
   - `getActiveDeployment()` - uses `getDeployments()`
   - `readProfileWithInheritance()` - recursive resolution using `readProfile()`
   - `validateProfile()` - schema validation
   - `buildProfileNotFoundError()` - error message generation
   - `detectLegacyConfiguration()` - legacy file detection (or make abstract?)

3. Define abstract storage primitives:
```typescript
export abstract class XDGBase implements IConfigStorage {
    // Abstract storage primitives (implemented by subclasses)
    protected abstract readProfileRaw(profile: string): ProfileConfig;
    protected abstract writeProfileRaw(profile: string, config: ProfileConfig): void;
    protected abstract deleteProfileRaw(profile: string): void;
    protected abstract listProfilesRaw(): string[];
    protected abstract profileExistsRaw(profile: string): boolean;
    protected abstract readDeploymentsRaw(profile: string): DeploymentHistory | null;
    protected abstract writeDeploymentsRaw(profile: string, history: DeploymentHistory): void;

    // Concrete public methods (use abstract primitives)
    public readProfile(profile: string): ProfileConfig {
        if (!this.profileExistsRaw(profile)) {
            throw new Error(this.buildProfileNotFoundError(profile));
        }
        const config = this.readProfileRaw(profile);
        const validation = this.validateProfile(config);
        if (!validation.isValid) {
            throw new Error(`Invalid configuration: ${validation.errors.join(", ")}`);
        }
        return config;
    }

    public writeProfile(profile: string, config: ProfileConfig): void {
        const validation = this.validateProfile(config);
        if (!validation.isValid) {
            throw new Error(`Invalid configuration: ${validation.errors.join("\\n")}`);
        }
        this.writeProfileRaw(profile, config);
    }

    // ... all other concrete methods
}
```

### Phase 2: Refactor XDGConfig

**File: `lib/xdg-config.ts`** (modify)

1. Change from `implements IConfigStorage` to `extends XDGBase`
2. Remove all business logic (moved to XDGBase)
3. Keep only:
   - Constructor (baseDir initialization)
   - Filesystem-specific primitives
   - Legacy detection logic (if filesystem-specific)

```typescript
export class XDGConfig extends XDGBase {
    private readonly baseDir: string;

    constructor(baseDir?: string) {
        super();
        this.baseDir = baseDir || this.getDefaultBaseDir();
        this.ensureBaseDirectoryExists();
    }

    protected readProfileRaw(profile: string): ProfileConfig {
        const profilePath = this.getProfilePath(profile);
        const configFile = join(profilePath, "config.json");
        const data = readFileSync(configFile, "utf-8");
        return JSON.parse(data);
    }

    protected writeProfileRaw(profile: string, config: ProfileConfig): void {
        const profilePath = this.getProfilePath(profile);
        mkdirSync(profilePath, { recursive: true });
        const configFile = join(profilePath, "config.json");
        writeFileSync(configFile, JSON.stringify(config, null, 4), "utf-8");
    }

    // ... other filesystem primitives
}
```

### Phase 3: Refactor MockConfigStorage → XDGTest

**File: `test/xdg-test.ts`** (rename from `test/mocks/mock-config-storage.ts`)

1. Rename class: `MockConfigStorage` → `XDGTest`
2. Change from `implements IConfigStorage` to `extends XDGBase`
3. Remove all business logic (moved to XDGBase)
4. Keep only in-memory storage primitives

```typescript
export class XDGTest extends XDGBase {
    private profiles: Map<string, ProfileConfig> = new Map();
    private deployments: Map<string, DeploymentHistory> = new Map();

    public clear(): void {
        this.profiles.clear();
        this.deployments.clear();
    }

    protected readProfileRaw(profile: string): ProfileConfig {
        const config = this.profiles.get(profile);
        if (!config) {
            throw new Error(`Profile not found: ${profile}`);
        }
        return JSON.parse(JSON.stringify(config)); // Deep copy
    }

    protected writeProfileRaw(profile: string, config: ProfileConfig): void {
        this.profiles.set(profile, JSON.parse(JSON.stringify(config)));
    }

    // ... other in-memory primitives
}
```

### Phase 4: Update Tests

**1. Update all existing tests:**
- Replace `MockConfigStorage` imports with `XDGTest`
- Replace `new MockConfigStorage()` with `new XDGTest()`
- No other changes needed (same interface)

**2. Create dedicated XDGConfig unit test:**

**File: `test/unit/xdg-config-filesystem.test.ts`** (new)

```typescript
describe("XDGConfig Filesystem Operations", () => {
    let testBaseDir: string;
    let xdgConfig: XDGConfig;

    beforeEach(() => {
        testBaseDir = join(tmpdir(), `xdg-test-${Date.now()}-${Math.random()}`);
        mkdirSync(testBaseDir, { recursive: true });
        xdgConfig = new XDGConfig(testBaseDir);
    });

    afterEach(() => {
        if (existsSync(testBaseDir)) {
            rmSync(testBaseDir, { recursive: true, force: true });
        }
    });

    it("should write and read profile from filesystem", () => {
        const config: ProfileConfig = { /* valid config */ };
        xdgConfig.writeProfile("test", config);
        const read = xdgConfig.readProfile("test");
        expect(read).toEqual(config);
    });

    it("should create profile directory structure", () => {
        const config: ProfileConfig = { /* valid config */ };
        xdgConfig.writeProfile("test", config);
        const profileDir = join(testBaseDir, "test");
        const configFile = join(profileDir, "config.json");
        expect(existsSync(profileDir)).toBe(true);
        expect(existsSync(configFile)).toBe(true);
    });

    it("should list profiles from filesystem", () => {
        xdgConfig.writeProfile("profile1", { /* config */ });
        xdgConfig.writeProfile("profile2", { /* config */ });
        const profiles = xdgConfig.listProfiles();
        expect(profiles).toEqual(["profile1", "profile2"]);
    });

    it("should delete profile from filesystem", () => {
        xdgConfig.writeProfile("test", { /* config */ });
        xdgConfig.deleteProfile("test");
        expect(xdgConfig.profileExists("test")).toBe(false);
    });

    // ... comprehensive filesystem operation tests
});
```

**3. Create XDGTest unit test:**

**File: `test/unit/xdg-test.test.ts`** (new)

```typescript
describe("XDGTest In-Memory Operations", () => {
    let xdgTest: XDGTest;

    beforeEach(() => {
        xdgTest = new XDGTest();
    });

    afterEach(() => {
        xdgTest.clear();
    });

    it("should store and retrieve profiles in memory", () => {
        const config: ProfileConfig = { /* valid config */ };
        xdgTest.writeProfile("test", config);
        const read = xdgTest.readProfile("test");
        expect(read).toEqual(config);
    });

    it("should clear all profiles", () => {
        xdgTest.writeProfile("test1", { /* config */ });
        xdgTest.writeProfile("test2", { /* config */ });
        xdgTest.clear();
        expect(xdgTest.listProfiles()).toEqual([]);
    });

    // ... in-memory operation tests
});
```

### Phase 5: Update Imports

Update all files that import configuration storage:

**Production code:**
- `bin/commands/deploy.ts` - no change (uses XDGConfig)
- `bin/commands/sync-secrets.ts` - change parameter type from `IConfigStorage` to `XDGBase`
- `lib/configuration-wizard.ts` - no change (uses XDGConfig)

**Test code:**
- All test files - replace `MockConfigStorage` with `XDGTest`
- `test/mocks/index.ts` - export `XDGTest` instead of `MockConfigStorage`

## Benefits

### 1. Coverage Problem Solved
- XDGConfig gets dedicated unit tests covering all filesystem operations
- XDGBase shared logic is exercised by both XDGConfig and XDGTest tests
- Tests using XDGTest still provide coverage for business logic

### 2. Code Reuse
- Shared logic exists in exactly one place (XDGBase)
- No duplication between XDGConfig and MockConfigStorage
- Both implementations guaranteed to have identical behavior for business logic

### 3. Clear Separation of Concerns
- XDGBase: Business logic (validation, inheritance, error handling)
- XDGConfig: Filesystem I/O
- XDGTest: In-memory storage

### 4. Better Testing Strategy
- Unit test XDGConfig filesystem operations in isolation
- Unit test XDGTest in-memory operations
- Integration tests use XDGTest for speed and isolation
- No more jest.mock() code smell

### 5. Maintainability
- Changes to business logic only need to be made in XDGBase
- Changes to storage mechanism only affect concrete classes
- Clear inheritance hierarchy

## File Structure

```
lib/
  ├── interfaces/
  │   └── config-storage.ts          (interface - unchanged)
  ├── xdg-base.ts                    (NEW - abstract base class)
  ├── xdg-config.ts                  (MODIFIED - extends XDGBase)
  └── types/
      └── config.ts                   (unchanged)

test/
  ├── xdg-test.ts                    (NEW - renamed from mocks/mock-config-storage.ts)
  ├── unit/
  │   ├── xdg-config-filesystem.test.ts  (NEW - XDGConfig unit tests)
  │   └── xdg-test.test.ts           (NEW - XDGTest unit tests)
  ├── integration/
  │   ├── fresh-install.test.ts      (MODIFIED - use XDGTest)
  │   ├── multi-profile.test.ts      (MODIFIED - use XDGTest)
  │   └── legacy-detection.test.ts   (unchanged - uses real XDGConfig)
  └── sync-secrets.test.ts           (MODIFIED - use XDGTest)
```

## Migration Checklist

- [ ] Create `lib/xdg-base.ts` with abstract class
- [ ] Move business logic from `lib/xdg-config.ts` to `lib/xdg-base.ts`
- [ ] Refactor `lib/xdg-config.ts` to extend XDGBase
- [ ] Rename `test/mocks/mock-config-storage.ts` to `test/xdg-test.ts`
- [ ] Refactor XDGTest to extend XDGBase
- [ ] Create `test/unit/xdg-config-filesystem.test.ts`
- [ ] Create `test/unit/xdg-test.test.ts`
- [ ] Update all test imports: MockConfigStorage → XDGTest
- [ ] Update `bin/commands/sync-secrets.ts` to use XDGBase type
- [ ] Update `test/mocks/index.ts` exports
- [ ] Run tests and verify coverage ≥ 65%
- [ ] Update documentation
- [ ] Commit changes

## Success Criteria

1. ✅ All 435+ tests passing
2. ✅ Coverage ≥ 65% (especially branch coverage)
3. ✅ No jest.mock() in codebase
4. ✅ XDGConfig has dedicated unit tests
5. ✅ XDGTest has dedicated unit tests
6. ✅ All integration tests use XDGTest
7. ✅ No code duplication between implementations
8. ✅ Clear separation of concerns

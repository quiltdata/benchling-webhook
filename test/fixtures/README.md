# Test Fixtures for v0.7.0 Configuration Architecture

This directory contains test fixtures for the new v0.7.0 configuration format and legacy v0.6.x formats for migration testing.

## v0.7.0 Fixtures

### config-v0.7.0.json
Complete ProfileConfig with all fields populated. Represents a typical production configuration.

### config-v0.7.0-dev.json
ProfileConfig with inheritance (`_inherits: "default"`). Demonstrates profile hierarchy with selective overrides.

### config-v0.7.0-minimal.json
Minimal ProfileConfig with only required fields. Useful for testing schema validation.

### config-v0.7.0-invalid.json
Invalid ProfileConfig missing required fields. Used to test validation error handling.

### config-v0.7.0-inheritance-circular.json
Invalid ProfileConfig with circular inheritance. Used to test circular dependency detection.

### deployments-v0.7.0.json
Complete DeploymentHistory with active deployments and history. Shows multi-stage deployment tracking.

## Legacy v0.6.x Fixtures (for migration testing)

### migration-v0.6-default.json
Legacy user configuration format from `~/.config/benchling-webhook/default.json`.
Demonstrates flat key structure with prefixed names.

### migration-v0.6-deploy.json
Legacy deployment tracking format from `~/.config/benchling-webhook/deploy.json`.
Shows stage-based deployment tracking (not profile-based).

## Usage in Tests

```typescript
import { ProfileConfig, DeploymentHistory } from '../lib/types/config';
import defaultConfig from './fixtures/config-v0.7.0.json';
import devConfig from './fixtures/config-v0.7.0-dev.json';
import deployments from './fixtures/deployments-v0.7.0.json';

// Type-safe fixtures
const config: ProfileConfig = defaultConfig;
const history: DeploymentHistory = deployments;
```

## Validation Testing

Use these fixtures to test:
- ✅ Valid configuration acceptance
- ❌ Invalid configuration rejection
- 🔄 Profile inheritance and merging
- 🔁 Circular inheritance detection
- 📦 Deployment history tracking
- 🔀 Migration from v0.6.x to v0.7.0

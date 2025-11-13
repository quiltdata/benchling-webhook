/**
 * Tests for next steps generator
 *
 * @module tests/lib/next-steps-generator
 */

import { generateNextSteps } from '../../lib/next-steps-generator';
import { ExecutionContext } from '../../lib/types/next-steps';

describe('generateNextSteps', () => {
  // Helper to create contexts
  const createRepositoryContext = (): ExecutionContext => ({
    isRepository: true,
    isNpx: false,
    packageName: '@quiltdata/benchling-webhook',
    availableScripts: ['deploy', 'deploy:dev', 'deploy:prod', 'test', 'test:dev', 'test:prod']
  });

  const createNpxContext = (): ExecutionContext => ({
    isRepository: false,
    isNpx: true,
    packageName: '@quiltdata/benchling-webhook',
    availableScripts: []
  });

  describe('backward compatibility (auto-detection)', () => {
    it('should work without context parameter', () => {
      const result = generateNextSteps({ profile: 'default' });

      expect(result).toBeTruthy();
      expect(result).toContain('Next steps:');
      // Should contain either npm run or npx (depending on detection)
      expect(result).toMatch(/(npm run|npx)/);
    });

    it('should produce same output as before for default profile (repository)', () => {
      const context = createRepositoryContext();
      const result = generateNextSteps({ profile: 'default', context });

      // Expected output from original implementation
      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy',
        '  2. Test integration: npm run test'
      ].join('\n');

      expect(result).toBe(expected);
    });

    it('should produce same output as before for dev profile (repository)', () => {
      const context = createRepositoryContext();
      const result = generateNextSteps({ profile: 'dev', context });

      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy:dev',
        '  2. Test integration: npm run test:dev'
      ].join('\n');

      expect(result).toBe(expected);
    });

    it('should produce same output as before for prod profile (repository)', () => {
      const context = createRepositoryContext();
      const result = generateNextSteps({ profile: 'prod', context });

      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy:prod',
        '  2. Test integration: npm run test:prod'
      ].join('\n');

      expect(result).toBe(expected);
    });

    it('should produce same output as before for custom profile (repository)', () => {
      const context = createRepositoryContext();
      const result = generateNextSteps({ profile: 'staging', context });

      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy -- --profile staging --stage staging',
        '  2. Check logs: npx ts-node scripts/check-logs.ts --profile staging'
      ].join('\n');

      expect(result).toBe(expected);
    });
  });

  describe('repository context (npm scripts)', () => {
    const context = createRepositoryContext();

    describe('default profile', () => {
      it('should generate npm run commands', () => {
        const result = generateNextSteps({ profile: 'default', context });

        expect(result).toContain('Next steps:');
        expect(result).toContain('npm run deploy');
        expect(result).toContain('npm run test');
        expect(result).not.toContain('npx');
        expect(result).not.toContain('--profile');
      });

      it('should match exact expected output', () => {
        const result = generateNextSteps({ profile: 'default', context });
        const expected = [
          'Next steps:',
          '  1. Deploy to AWS: npm run deploy',
          '  2. Test integration: npm run test'
        ].join('\n');

        expect(result).toBe(expected);
      });
    });

    describe('dev profile', () => {
      it('should generate npm run commands with :dev suffix', () => {
        const result = generateNextSteps({ profile: 'dev', context });

        expect(result).toContain('npm run deploy:dev');
        expect(result).toContain('npm run test:dev');
        expect(result).not.toContain('npx');
      });

      it('should match exact expected output', () => {
        const result = generateNextSteps({ profile: 'dev', context });
        const expected = [
          'Next steps:',
          '  1. Deploy to AWS: npm run deploy:dev',
          '  2. Test integration: npm run test:dev'
        ].join('\n');

        expect(result).toBe(expected);
      });
    });

    describe('prod profile', () => {
      it('should generate npm run commands with :prod suffix', () => {
        const result = generateNextSteps({ profile: 'prod', context });

        expect(result).toContain('npm run deploy:prod');
        expect(result).toContain('npm run test:prod');
        expect(result).not.toContain('npx @quiltdata/benchling-webhook');
      });

      it('should match exact expected output', () => {
        const result = generateNextSteps({ profile: 'prod', context });
        const expected = [
          'Next steps:',
          '  1. Deploy to AWS: npm run deploy:prod',
          '  2. Test integration: npm run test:prod'
        ].join('\n');

        expect(result).toBe(expected);
      });
    });

    describe('custom profile', () => {
      it('should generate npm run deploy with profile flag', () => {
        const result = generateNextSteps({ profile: 'staging', context });

        expect(result).toContain('npm run deploy -- --profile staging --stage staging');
        expect(result).toContain('npx ts-node scripts/check-logs.ts --profile staging');
      });

      it('should work with different custom profile names', () => {
        const result = generateNextSteps({ profile: 'test-env', context });

        expect(result).toContain('--profile test-env');
        expect(result).toContain('npx ts-node scripts/check-logs.ts --profile test-env');
      });

      it('should match exact expected output', () => {
        const result = generateNextSteps({ profile: 'staging', context });
        const expected = [
          'Next steps:',
          '  1. Deploy to AWS: npm run deploy -- --profile staging --stage staging',
          '  2. Check logs: npx ts-node scripts/check-logs.ts --profile staging'
        ].join('\n');

        expect(result).toBe(expected);
      });
    });
  });

  describe('npx context', () => {
    const context = createNpxContext();

    describe('default profile', () => {
      it('should generate npx commands', () => {
        const result = generateNextSteps({ profile: 'default', context });

        expect(result).toContain('Next steps:');
        expect(result).toContain('npx @quiltdata/benchling-webhook deploy');
        expect(result).toContain('npx @quiltdata/benchling-webhook test');
        expect(result).not.toContain('npm run');
      });

      it('should not include profile flags for default', () => {
        const result = generateNextSteps({ profile: 'default', context });

        expect(result).not.toContain('--profile');
        expect(result).not.toContain('--stage');
      });

      it('should match exact expected output', () => {
        const result = generateNextSteps({ profile: 'default', context });
        const expected = [
          'Next steps:',
          '  1. Deploy to AWS: npx @quiltdata/benchling-webhook deploy',
          '  2. Test integration: npx @quiltdata/benchling-webhook test'
        ].join('\n');

        expect(result).toBe(expected);
      });
    });

    describe('dev profile', () => {
      it('should generate npx commands with profile and stage flags', () => {
        const result = generateNextSteps({ profile: 'dev', context });

        expect(result).toContain('npx @quiltdata/benchling-webhook deploy --profile dev --stage dev');
        expect(result).toContain('npx @quiltdata/benchling-webhook test --profile dev');
        expect(result).not.toContain('npm run');
      });

      it('should match exact expected output', () => {
        const result = generateNextSteps({ profile: 'dev', context });
        const expected = [
          'Next steps:',
          '  1. Deploy to AWS: npx @quiltdata/benchling-webhook deploy --profile dev --stage dev',
          '  2. Test integration: npx @quiltdata/benchling-webhook test --profile dev'
        ].join('\n');

        expect(result).toBe(expected);
      });
    });

    describe('prod profile', () => {
      it('should generate npx commands with profile and prod stage', () => {
        const result = generateNextSteps({ profile: 'prod', context });

        expect(result).toContain('npx @quiltdata/benchling-webhook deploy --profile prod --stage prod');
        expect(result).toContain('npx @quiltdata/benchling-webhook test --profile prod');
        expect(result).not.toContain('npm run');
      });

      it('should match exact expected output', () => {
        const result = generateNextSteps({ profile: 'prod', context });
        const expected = [
          'Next steps:',
          '  1. Deploy to AWS: npx @quiltdata/benchling-webhook deploy --profile prod --stage prod',
          '  2. Test integration: npx @quiltdata/benchling-webhook test --profile prod'
        ].join('\n');

        expect(result).toBe(expected);
      });
    });

    describe('custom profile', () => {
      it('should generate npx commands with custom profile', () => {
        const result = generateNextSteps({ profile: 'staging', context });

        expect(result).toContain('npx @quiltdata/benchling-webhook deploy --profile staging --stage staging');
        expect(result).toContain('npx @quiltdata/benchling-webhook logs --profile staging');
      });

      it('should use logs command for custom profiles', () => {
        const result = generateNextSteps({ profile: 'test-env', context });

        expect(result).toContain('npx @quiltdata/benchling-webhook logs --profile test-env');
        expect(result).not.toContain('check-logs.ts');
      });

      it('should match exact expected output', () => {
        const result = generateNextSteps({ profile: 'staging', context });
        const expected = [
          'Next steps:',
          '  1. Deploy to AWS: npx @quiltdata/benchling-webhook deploy --profile staging --stage staging',
          '  2. Check logs: npx @quiltdata/benchling-webhook logs --profile staging'
        ].join('\n');

        expect(result).toBe(expected);
      });
    });
  });

  describe('output format', () => {
    it('should start with "Next steps:"', () => {
      const result = generateNextSteps({ profile: 'default' });
      expect(result).toMatch(/^Next steps:/);
    });

    it('should have numbered steps', () => {
      const result = generateNextSteps({ profile: 'default' });
      expect(result).toMatch(/1\. Deploy to AWS:/);
      expect(result).toMatch(/2\. (Test|Check)/);
    });

    it('should use consistent indentation', () => {
      const result = generateNextSteps({ profile: 'default' });
      const lines = result.split('\n');
      const stepLines = lines.filter(l => l.match(/^\s+\d\./));

      stepLines.forEach(line => {
        expect(line).toMatch(/^  \d\./); // Two spaces
      });
    });

    it('should not have trailing newline', () => {
      const result = generateNextSteps({ profile: 'default' });
      expect(result).not.toMatch(/\n$/);
    });
  });

  describe('edge cases', () => {
    const repoContext = createRepositoryContext();

    it('should handle empty string profile by defaulting to default', () => {
      const result = generateNextSteps({ profile: '', context: repoContext });

      expect(result).toBeTruthy();
      expect(result).toContain('Next steps:');
      expect(result).toContain('npm run deploy');
    });

    it('should handle profile with special characters', () => {
      const result = generateNextSteps({ profile: 'test-env-2', context: repoContext });

      expect(result).toContain('--profile test-env-2');
      expect(result).toContain('npx ts-node scripts/check-logs.ts --profile test-env-2');
    });

    it('should handle undefined stage', () => {
      const result = generateNextSteps({ profile: 'default', stage: undefined, context: repoContext });

      expect(result).toBeTruthy();
      expect(result).toContain('npm run deploy');
    });

    it('should handle profile with hyphens', () => {
      const result = generateNextSteps({ profile: 'sales-demo', context: repoContext });

      expect(result).toContain('--profile sales-demo');
    });

    it('should handle profile with underscores', () => {
      const result = generateNextSteps({ profile: 'test_env', context: repoContext });

      expect(result).toContain('--profile test_env');
    });
  });

  describe('context switching', () => {
    it('should generate different commands for same profile in different contexts', () => {
      const repoContext = createRepositoryContext();
      const npxContext = createNpxContext();

      const repoResult = generateNextSteps({ profile: 'dev', context: repoContext });
      const npxResult = generateNextSteps({ profile: 'dev', context: npxContext });

      expect(repoResult).toContain('npm run deploy:dev');
      expect(npxResult).toContain('npx @quiltdata/benchling-webhook deploy --profile dev');
      expect(repoResult).not.toBe(npxResult);
    });

    it('should handle custom profile differently in each context', () => {
      const repoContext = createRepositoryContext();
      const npxContext = createNpxContext();

      const repoResult = generateNextSteps({ profile: 'staging', context: repoContext });
      const npxResult = generateNextSteps({ profile: 'staging', context: npxContext });

      expect(repoResult).toContain('npm run deploy -- --profile staging');
      expect(repoResult).toContain('check-logs.ts');
      expect(npxResult).toContain('npx @quiltdata/benchling-webhook deploy --profile staging');
      expect(npxResult).toContain('npx @quiltdata/benchling-webhook logs');
    });
  });

  describe('return type', () => {
    it('should return a string', () => {
      const result = generateNextSteps({ profile: 'default' });
      expect(typeof result).toBe('string');
    });

    it('should return non-empty string', () => {
      const result = generateNextSteps({ profile: 'default' });
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return multi-line string', () => {
      const result = generateNextSteps({ profile: 'default' });
      const lines = result.split('\n');
      expect(lines.length).toBeGreaterThan(1);
    });
  });
});

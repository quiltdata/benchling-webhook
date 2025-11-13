/**
 * Tests for next steps generator
 *
 * @module tests/lib/next-steps-generator
 */

import { generateNextSteps } from '../../lib/next-steps-generator';

describe('generateNextSteps', () => {
  describe('default profile', () => {
    it('should generate next steps for default profile', () => {
      const result = generateNextSteps({ profile: 'default' });

      expect(result).toContain('Next steps:');
      expect(result).toContain('npm run deploy');
      expect(result).toContain('npm run test');
      expect(result).not.toContain('--profile');
    });

    it('should match exact expected output', () => {
      const result = generateNextSteps({ profile: 'default' });
      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy',
        '  2. Test integration: npm run test'
      ].join('\n');

      expect(result).toBe(expected);
    });
  });

  describe('dev profile', () => {
    it('should generate next steps for dev profile', () => {
      const result = generateNextSteps({ profile: 'dev' });

      expect(result).toContain('npm run deploy:dev');
      expect(result).toContain('npm run test:dev');
    });

    it('should match exact expected output', () => {
      const result = generateNextSteps({ profile: 'dev' });
      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy:dev',
        '  2. Test integration: npm run test:dev'
      ].join('\n');

      expect(result).toBe(expected);
    });
  });

  describe('prod profile', () => {
    it('should generate next steps for prod profile', () => {
      const result = generateNextSteps({ profile: 'prod' });

      expect(result).toContain('npm run deploy:prod');
      expect(result).toContain('npm run test:prod');
    });

    it('should match exact expected output', () => {
      const result = generateNextSteps({ profile: 'prod' });
      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy:prod',
        '  2. Test integration: npm run test:prod'
      ].join('\n');

      expect(result).toBe(expected);
    });
  });

  describe('custom profile', () => {
    it('should generate next steps for custom profile', () => {
      const result = generateNextSteps({ profile: 'staging' });

      expect(result).toContain('npm run deploy -- --profile staging');
      expect(result).toContain('npx ts-node scripts/check-logs.ts --profile staging');
    });

    it('should work with different custom profile names', () => {
      const result = generateNextSteps({ profile: 'test-env' });

      expect(result).toContain('--profile test-env');
      expect(result).toContain('npx ts-node scripts/check-logs.ts --profile test-env');
    });

    it('should match exact expected output', () => {
      const result = generateNextSteps({ profile: 'staging' });
      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy -- --profile staging --stage staging',
        '  2. Check logs: npx ts-node scripts/check-logs.ts --profile staging'
      ].join('\n');

      expect(result).toBe(expected);
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
    it('should handle empty string profile by defaulting to default', () => {
      const result = generateNextSteps({ profile: '' });

      expect(result).toBeTruthy();
      expect(result).toContain('Next steps:');
      expect(result).toContain('npm run deploy');
    });

    it('should handle profile with special characters', () => {
      const result = generateNextSteps({ profile: 'test-env-2' });

      expect(result).toContain('--profile test-env-2');
      expect(result).toContain('npx ts-node scripts/check-logs.ts --profile test-env-2');
    });

    it('should handle undefined stage', () => {
      const result = generateNextSteps({ profile: 'default', stage: undefined });

      expect(result).toBeTruthy();
      expect(result).toContain('npm run deploy');
    });

    it('should handle profile with hyphens', () => {
      const result = generateNextSteps({ profile: 'sales-demo' });

      expect(result).toContain('--profile sales-demo');
    });

    it('should handle profile with underscores', () => {
      const result = generateNextSteps({ profile: 'test_env' });

      expect(result).toContain('--profile test_env');
    });
  });

  describe('backward compatibility', () => {
    it('should produce same output as before for default profile', () => {
      const result = generateNextSteps({ profile: 'default' });

      // Expected output from original implementation
      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy',
        '  2. Test integration: npm run test'
      ].join('\n');

      expect(result).toBe(expected);
    });

    it('should produce same output as before for dev profile', () => {
      const result = generateNextSteps({ profile: 'dev' });

      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy:dev',
        '  2. Test integration: npm run test:dev'
      ].join('\n');

      expect(result).toBe(expected);
    });

    it('should produce same output as before for prod profile', () => {
      const result = generateNextSteps({ profile: 'prod' });

      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy:prod',
        '  2. Test integration: npm run test:prod'
      ].join('\n');

      expect(result).toBe(expected);
    });

    it('should produce same output as before for custom profile', () => {
      const result = generateNextSteps({ profile: 'staging' });

      const expected = [
        'Next steps:',
        '  1. Deploy to AWS: npm run deploy -- --profile staging --stage staging',
        '  2. Check logs: npx ts-node scripts/check-logs.ts --profile staging'
      ].join('\n');

      expect(result).toBe(expected);
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

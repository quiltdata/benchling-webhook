/**
 * Tests for execution context detector
 *
 * @module test/lib/context-detector
 */

import * as fs from 'fs';
import * as path from 'path';
import { detectExecutionContext } from '../../lib/context-detector';

// Mock file system for deterministic tests
jest.mock('fs');

describe('detectExecutionContext', () => {
  const mockFs = fs as jest.Mocked<typeof fs>;

  // Store original implementations
  const originalCwd = process.cwd;

  // Helper to setup mocks for repository context
  const setupRepositoryContext = (scripts: Record<string, string> = {}) => {
    const packageJson = {
      name: '@quiltdata/benchling-webhook',
      scripts
    };

    // Mock process.cwd to return a known directory
    process.cwd = jest.fn().mockReturnValue('/test/project');

    mockFs.existsSync.mockImplementation((filePath: any) => {
      const pathStr = filePath.toString();
      if (pathStr.includes('package.json')) return true;
      if (pathStr.endsWith('/lib') || pathStr.endsWith('\\lib')) return true;
      return false;
    });

    mockFs.readFileSync.mockImplementation((filePath: any) => {
      if (filePath.toString().includes('package.json')) {
        return JSON.stringify(packageJson);
      }
      return '';
    });

    mockFs.readdirSync.mockImplementation((dirPath: any) => {
      const pathStr = dirPath.toString();
      if (pathStr.endsWith('/lib') || pathStr.endsWith('\\lib')) {
        return ['context-detector.ts', 'next-steps-generator.ts'] as any;
      }
      return [] as any;
    });
  };

  // Helper to setup mocks for npx context
  const setupNpxContext = () => {
    // Mock process.cwd to return a known directory
    process.cwd = jest.fn().mockReturnValue('/test/npx');

    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('File not found');
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    // Restore original process.cwd
    process.cwd = originalCwd;
  });

  describe('repository context detection', () => {
    it('should detect repository with package.json and source files', () => {
      setupRepositoryContext({
        deploy: 'ts-node bin/cli.ts deploy',
        test: 'jest'
      });

      const context = detectExecutionContext();

      expect(context.isRepository).toBe(true);
      expect(context.isNpx).toBe(false);
      expect(context.packageName).toBe('@quiltdata/benchling-webhook');
    });

    it('should extract available npm scripts', () => {
      setupRepositoryContext({
        deploy: 'ts-node bin/cli.ts deploy',
        'deploy:dev': 'ts-node bin/cli.ts deploy --profile dev',
        'deploy:prod': 'ts-node bin/cli.ts deploy --profile prod',
        test: 'jest',
        'test:dev': 'npm run test'
      });

      const context = detectExecutionContext();

      expect(context.availableScripts).toContain('deploy');
      expect(context.availableScripts).toContain('deploy:dev');
      expect(context.availableScripts).toContain('deploy:prod');
      expect(context.availableScripts).toContain('test');
      expect(context.availableScripts).toContain('test:dev');
      expect(context.availableScripts).toHaveLength(5);
    });

    it('should set isRepository to true and isNpx to false', () => {
      setupRepositoryContext();

      const context = detectExecutionContext();

      expect(context.isRepository).toBe(true);
      expect(context.isNpx).toBe(false);
    });

    it('should validate package name matches', () => {
      const wrongPackage = {
        name: 'some-other-package',
        scripts: {}
      };

      process.cwd = jest.fn().mockReturnValue('/test/project');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(wrongPackage));

      const context = detectExecutionContext();

      // Wrong package name should be treated as npx
      expect(context.isRepository).toBe(false);
      expect(context.isNpx).toBe(true);
    });
  });

  describe('npx context detection', () => {
    it('should detect npx when no package.json exists', () => {
      setupNpxContext();

      const context = detectExecutionContext();

      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
      expect(context.packageName).toBe('@quiltdata/benchling-webhook');
      expect(context.availableScripts).toEqual([]);
    });

    it('should detect npx when package name differs', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ name: 'different-package' })
      );

      const context = detectExecutionContext();

      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });

    it('should detect npx when lib directory missing', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');

      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('package.json')) return true;
        if (pathStr.endsWith('/lib') || pathStr.endsWith('\\lib')) return false; // No lib directory
        return false;
      });

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ name: '@quiltdata/benchling-webhook' })
      );

      const context = detectExecutionContext();

      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });

    it('should detect npx when lib has only .js files', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');

      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('package.json')) return true;
        if (pathStr.endsWith('/lib') || pathStr.endsWith('\\lib')) return true;
        return false;
      });

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ name: '@quiltdata/benchling-webhook' })
      );

      // Only compiled JS files, no TypeScript source
      mockFs.readdirSync.mockReturnValue(['index.js', 'utils.js'] as any);

      const context = detectExecutionContext();

      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });

    it('should set isNpx to true and isRepository to false', () => {
      setupNpxContext();

      const context = detectExecutionContext();

      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });

    it('should have empty availableScripts array', () => {
      setupNpxContext();

      const context = detectExecutionContext();

      expect(context.availableScripts).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should handle malformed package.json gracefully', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{ invalid json }');

      const context = detectExecutionContext();

      // Should default to npx on JSON parse error
      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });

    it('should handle missing package.json name field', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ scripts: {} }));

      const context = detectExecutionContext();

      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });

    it('should handle package.json without scripts field', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');

      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('package.json')) return true;
        if (pathStr.endsWith('/lib') || pathStr.endsWith('\\lib')) return true;
        return false;
      });

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ name: '@quiltdata/benchling-webhook' })
      );

      mockFs.readdirSync.mockReturnValue(['index.ts'] as any);

      const context = detectExecutionContext();

      expect(context.isRepository).toBe(true);
      expect(context.availableScripts).toEqual([]);
    });

    it('should handle read errors gracefully', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const context = detectExecutionContext();

      // Should default to npx on read error
      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });

    it('should handle empty lib directory', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');

      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('package.json')) return true;
        if (pathStr.endsWith('/lib') || pathStr.endsWith('\\lib')) return true;
        return false;
      });

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ name: '@quiltdata/benchling-webhook' })
      );

      mockFs.readdirSync.mockReturnValue([] as any); // Empty directory

      const context = detectExecutionContext();

      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });

    it('should default to npx on any errors', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');

      mockFs.existsSync.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const context = detectExecutionContext();

      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });

    it('should handle null package.json', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('null');

      const context = detectExecutionContext();

      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });

    it('should handle array as package.json', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('[]');

      const context = detectExecutionContext();

      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });

    it('should handle readdirSync errors', () => {
      process.cwd = jest.fn().mockReturnValue('/test/project');

      mockFs.existsSync.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        if (pathStr.includes('package.json')) return true;
        if (pathStr.endsWith('/lib') || pathStr.endsWith('\\lib')) return true;
        return false;
      });

      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({ name: '@quiltdata/benchling-webhook' })
      );

      mockFs.readdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const context = detectExecutionContext();

      // Should treat as npx if can't read lib directory
      expect(context.isNpx).toBe(true);
      expect(context.isRepository).toBe(false);
    });
  });

  describe('return value structure', () => {
    it('should always return ExecutionContext object', () => {
      setupNpxContext();

      const context = detectExecutionContext();

      expect(context).toBeDefined();
      expect(typeof context).toBe('object');
      expect(context).toHaveProperty('isRepository');
      expect(context).toHaveProperty('isNpx');
      expect(context).toHaveProperty('packageName');
      expect(context).toHaveProperty('availableScripts');
    });

    it('should have boolean isRepository', () => {
      setupNpxContext();

      const context = detectExecutionContext();

      expect(typeof context.isRepository).toBe('boolean');
    });

    it('should have boolean isNpx', () => {
      setupNpxContext();

      const context = detectExecutionContext();

      expect(typeof context.isNpx).toBe('boolean');
    });

    it('should have string packageName', () => {
      setupNpxContext();

      const context = detectExecutionContext();

      expect(typeof context.packageName).toBe('string');
      expect(context.packageName.length).toBeGreaterThan(0);
    });

    it('should have array availableScripts', () => {
      setupNpxContext();

      const context = detectExecutionContext();

      expect(Array.isArray(context.availableScripts)).toBe(true);
    });

    it('should have mutually exclusive isRepository and isNpx', () => {
      setupRepositoryContext();
      const repoContext = detectExecutionContext();
      expect(repoContext.isRepository && repoContext.isNpx).toBe(false);

      setupNpxContext();
      const npxContext = detectExecutionContext();
      expect(npxContext.isRepository && npxContext.isNpx).toBe(false);
    });
  });

  describe('consistent behavior', () => {
    it('should return consistent results for same inputs', () => {
      setupRepositoryContext({ deploy: 'test', test: 'jest' });

      const context1 = detectExecutionContext();
      const context2 = detectExecutionContext();

      expect(context1).toEqual(context2);
    });

    it('should always set packageName', () => {
      setupRepositoryContext();
      const repoContext = detectExecutionContext();
      expect(repoContext.packageName).toBe('@quiltdata/benchling-webhook');

      setupNpxContext();
      const npxContext = detectExecutionContext();
      expect(npxContext.packageName).toBe('@quiltdata/benchling-webhook');
    });
  });
});

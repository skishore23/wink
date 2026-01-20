import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectDetector, IProjectConfig } from '../core/projectDetector';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProjectDetector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectdetector-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detect()', () => {
    it('detects Node.js project from package.json', () => {
      const packageJson = {
        name: 'test-project',
        scripts: {
          test: 'jest',
          lint: 'eslint .',
          build: 'tsc'
        }
      };
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(packageJson)
      );

      const config = ProjectDetector.detect(tempDir);

      expect(config.type).toBe('node');
      expect(config.testCommand).toBe('npm test');
      expect(config.lintCommand).toBe('npm run lint');
      expect(config.buildCommand).toBe('npm run build');
      expect(config.fileExtensions).toContain('.ts');
    });

    it('returns undefined for commands when scripts not present', () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test' })
      );

      const config = ProjectDetector.detect(tempDir);

      // No scripts = no commands (user should configure)
      expect(config.type).toBe('node');
      expect(config.testCommand).toBeUndefined();
      expect(config.buildCommand).toBeUndefined();
    });

    it('detects Go project from go.mod', () => {
      fs.writeFileSync(
        path.join(tempDir, 'go.mod'),
        'module example.com/test\n\ngo 1.21'
      );

      const config = ProjectDetector.detect(tempDir);

      expect(config.type).toBe('go');
      expect(config.testCommand).toBe('go test ./...');
      expect(config.lintCommand).toBe('golangci-lint run');
      expect(config.typecheckCommand).toBe('go vet ./...');
      expect(config.buildCommand).toBe('go build ./...');
      expect(config.fileExtensions).toContain('.go');
    });

    it('detects Rust project from Cargo.toml', () => {
      fs.writeFileSync(
        path.join(tempDir, 'Cargo.toml'),
        '[package]\nname = "test"\nversion = "0.1.0"'
      );

      const config = ProjectDetector.detect(tempDir);

      expect(config.type).toBe('rust');
      expect(config.testCommand).toBe('cargo test');
      expect(config.lintCommand).toBe('cargo clippy');
      expect(config.buildCommand).toBe('cargo build');
      expect(config.fileExtensions).toContain('.rs');
    });

    it('detects Python project from requirements.txt', () => {
      fs.writeFileSync(
        path.join(tempDir, 'requirements.txt'),
        'pytest\nruff'
      );

      const config = ProjectDetector.detect(tempDir);

      expect(config.type).toBe('python');
      expect(config.testCommand).toBe('pytest');
      expect(config.lintCommand).toBe('ruff check');
      expect(config.typecheckCommand).toBe('mypy .');
      expect(config.fileExtensions).toContain('.py');
    });

    it('detects Python project from pyproject.toml', () => {
      fs.writeFileSync(
        path.join(tempDir, 'pyproject.toml'),
        '[build-system]\nrequires = ["setuptools"]'
      );

      const config = ProjectDetector.detect(tempDir);

      expect(config.type).toBe('python');
    });

    it('returns unknown for unrecognized projects', () => {
      const config = ProjectDetector.detect(tempDir);

      expect(config.type).toBe('unknown');
      expect(config.fileExtensions).toEqual([]);
    });

    it('prioritizes package.json over other markers', () => {
      // Create both package.json and go.mod
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test' })
      );
      fs.writeFileSync(
        path.join(tempDir, 'go.mod'),
        'module test'
      );

      const config = ProjectDetector.detect(tempDir);

      expect(config.type).toBe('node');
    });
  });
});

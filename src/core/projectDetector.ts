import * as fs from 'fs';
import * as path from 'path';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

export interface IProjectConfig {
  type: 'node' | 'go' | 'python' | 'rust' | 'unknown';
  packageManager?: PackageManager;
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
  securityCommand?: string;
  complexityAnalyzer?: 'typescript' | 'go' | 'python';
  fileExtensions: string[];
}

/**
 * Detect the package manager used in a project
 */
export function detectPackageManager(projectRoot: string): PackageManager {
  if (fs.existsSync(path.join(projectRoot, 'bun.lockb'))) {
    return 'bun';
  }
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

/**
 * Get the run command for a package manager
 */
export function getRunCommand(pm: PackageManager, script: string): string {
  switch (pm) {
    case 'bun': return `bun run ${script}`;
    case 'pnpm': return `pnpm run ${script}`;
    case 'yarn': return `yarn ${script}`;
    default: return `npm run ${script}`;
  }
}

/**
 * Get the test command for a package manager
 */
export function getTestCommand(pm: PackageManager): string {
  switch (pm) {
    case 'bun': return 'bun test';
    case 'pnpm': return 'pnpm test';
    case 'yarn': return 'yarn test';
    default: return 'npm test';
  }
}

/**
 * Get the audit command for a package manager
 */
export function getAuditCommand(pm: PackageManager): string {
  switch (pm) {
    case 'bun': return 'bun pm audit';
    case 'pnpm': return 'pnpm audit';
    case 'yarn': return 'yarn audit';
    default: return 'npm audit --audit-level=moderate';
  }
}

export class ProjectDetector {
  static detect(projectRoot: string): IProjectConfig {
    // Check for package.json (Node.js/TypeScript)
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const scripts = packageJson.scripts || {};
      const pm = detectPackageManager(projectRoot);

      return {
        type: 'node',
        packageManager: pm,
        testCommand: scripts.test ? getTestCommand(pm) : undefined,
        lintCommand: scripts.lint ? getRunCommand(pm, 'lint') : undefined,
        typecheckCommand: scripts.typecheck ? getRunCommand(pm, 'typecheck') : (scripts.build ? getRunCommand(pm, 'build') : undefined),
        buildCommand: scripts.build ? getRunCommand(pm, 'build') : undefined,
        securityCommand: getAuditCommand(pm),
        complexityAnalyzer: 'typescript',
        fileExtensions: ['.ts', '.tsx', '.js', '.jsx']
      };
    }
    
    // Check for go.mod (Go)
    if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
      return {
        type: 'go',
        testCommand: 'go test ./...',
        lintCommand: 'golangci-lint run',
        typecheckCommand: 'go vet ./...',
        buildCommand: 'go build ./...',
        securityCommand: 'gosec ./...',
        complexityAnalyzer: 'go',
        fileExtensions: ['.go']
      };
    }
    
    // Check for Cargo.toml (Rust)
    if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
      return {
        type: 'rust',
        testCommand: 'cargo test',
        lintCommand: 'cargo clippy',
        typecheckCommand: 'cargo check',
        buildCommand: 'cargo build',
        securityCommand: 'cargo audit',
        fileExtensions: ['.rs']
      };
    }
    
    // Check for requirements.txt or setup.py (Python)
    if (fs.existsSync(path.join(projectRoot, 'requirements.txt')) ||
        fs.existsSync(path.join(projectRoot, 'setup.py')) ||
        fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) {
      return {
        type: 'python',
        testCommand: 'pytest',
        lintCommand: 'ruff check',
        typecheckCommand: 'mypy .',
        buildCommand: 'python -m build',
        securityCommand: 'bandit -r .',
        complexityAnalyzer: 'python',
        fileExtensions: ['.py']
      };
    }
    
    return {
      type: 'unknown',
      fileExtensions: []
    };
  }
  
  static async detectAndSaveToClaude(projectRoot: string): Promise<void> {
    const config = this.detect(projectRoot);
    const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
    
    if (config.type !== 'unknown' && !fs.existsSync(claudeMdPath)) {
      const content = `# CLAUDE.md

This file provides guidance to Claude Code when working with this ${config.type} project.

## Auto-Detected Commands

${config.testCommand ? `- Test: \`${config.testCommand}\`` : ''}
${config.lintCommand ? `- Lint: \`${config.lintCommand}\`` : ''}
${config.typecheckCommand ? `- Type Check: \`${config.typecheckCommand}\`` : ''}
${config.buildCommand ? `- Build: \`${config.buildCommand}\`` : ''}

## Project Type
- Language: ${config.type}
- File Extensions: ${config.fileExtensions.join(', ')}
`;
      
      fs.writeFileSync(claudeMdPath, content);
    }
  }
}
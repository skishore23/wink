import * as fs from 'fs';
import * as path from 'path';

export interface IProjectConfig {
  type: 'node' | 'go' | 'python' | 'rust' | 'unknown';
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
  securityCommand?: string;
  complexityAnalyzer?: 'typescript' | 'go' | 'python';
  fileExtensions: string[];
}

export class ProjectDetector {
  static detect(projectRoot: string): IProjectConfig {
    // Check for package.json (Node.js/TypeScript)
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const scripts = packageJson.scripts || {};

      // Simple: if script exists, use npm run <name>
      return {
        type: 'node',
        testCommand: scripts.test ? 'npm test' : undefined,
        lintCommand: scripts.lint ? 'npm run lint' : undefined,
        typecheckCommand: scripts.build ? 'npm run build' : undefined,
        buildCommand: scripts.build ? 'npm run build' : undefined,
        securityCommand: 'npm audit --audit-level=moderate',
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
import { SessionInsights, HotFolder, CommonError, LoopPattern, QualityHotspot, FailedCheckSummary } from './sessionAnalyzer';
import { getThreshold } from './thresholdManager';
import * as path from 'path';

export interface AgentSuggestion {
  name: string;
  description: string;
  reason: string;
  focus: string[];
  markdown: string;
}

export class AgentGenerator {
  generate(insights: SessionInsights, userContext?: string): AgentSuggestion[] {
    const suggestions: AgentSuggestion[] = [];

    // Rule 1: Hot folder expert
    const hotFolderAgent = this.suggestHotFolderAgent(insights.hotFolders, insights.projectType);
    if (hotFolderAgent) suggestions.push(hotFolderAgent);

    // Rule 2: Error pattern specialist
    const errorAgent = this.suggestErrorAgent(insights.commonErrors, insights.projectType);
    if (errorAgent) suggestions.push(errorAgent);

    // Rule 3: Context keeper for loop patterns
    const contextAgent = this.suggestContextAgent(insights.loopPatterns);
    if (contextAgent) suggestions.push(contextAgent);

    // Rule 4: Language specialist
    const langAgent = this.suggestLanguageAgent(insights.projectType, insights.fileTypes);
    if (langAgent) suggestions.push(langAgent);

    // Rule 5: Quality guard for failing checks
    const qualityAgent = this.suggestQualityAgent(insights.qualityHotspots, insights.failedChecks, insights.projectType);
    if (qualityAgent) suggestions.push(qualityAgent);

    // Rule 6: Regression fixer when regressions appear
    const regressionAgent = this.suggestRegressionAgent(insights.failedChecks, insights.projectType);
    if (regressionAgent) suggestions.push(regressionAgent);

    // Add user context to all agents if provided
    if (userContext) {
      for (const agent of suggestions) {
        agent.markdown = this.appendUserContext(agent.markdown, userContext);
      }
    }

    return suggestions;
  }

  private suggestHotFolderAgent(folders: HotFolder[], projectType: string): AgentSuggestion | null {
    if (folders.length === 0) return null;

    const topFolder = folders[0];
    const threshold = getThreshold('folder-expert');
    if (topFolder.editCount < threshold) return null; // Not enough activity

    const folderName = path.basename(topFolder.path);
    const name = `${folderName}-expert`;

    const topFolders = folders.slice(0, 3);
    const folderList = topFolders.map(f => `- ${f.path} (${f.editCount} edits)`).join('\n');

    const markdown = `---
name: ${name}
description: Expert on ${folderName}/ folder patterns and code
tools: Read, Grep, Edit, Write
---

# ${this.capitalize(folderName)} Expert Agent

You are a specialized agent with deep knowledge of the \`${folderName}/\` directory.

## Your Expertise

You understand the patterns, conventions, and code structure in these folders:
${folderList}

## How to Use Your Knowledge

1. When asked about code in these folders, provide specific file references
2. Understand the relationships between files in this area
3. Know the common patterns and idioms used here
4. Can suggest edits that follow existing conventions

## Project Type
This is a ${projectType} project.
`;

    return {
      name,
      description: `Expert on ${folderName}/ folder`,
      reason: `${topFolder.editCount} edits in ${folderName}/`,
      focus: topFolders.map(f => f.path),
      markdown
    };
  }

  private suggestErrorAgent(errors: CommonError[], projectType: string): AgentSuggestion | null {
    if (errors.length === 0) return null;

    const topError = errors[0];
    const threshold = getThreshold('error-fixer');
    if (topError.count < threshold) return null; // Not enough errors

    const name = 'error-fixer';
    const errorList = errors.slice(0, 5).map(e => `- ${e.pattern} (${e.count}x)`).join('\n');
    const examples = errors.slice(0, 3)
      .flatMap(e => e.examples)
      .slice(0, 3)
      .map(e => `  - ${e}`)
      .join('\n');

    const markdown = `---
name: ${name}
description: Specializes in fixing common errors in this codebase
tools: Read, Grep, Edit, Bash
---

# Error Fixer Agent

You specialize in fixing the common errors that occur in this ${projectType} codebase.

## Common Error Patterns

${errorList}

## Example Errors You've Seen

${examples}

## Your Approach

1. Identify the root cause of the error
2. Check for similar patterns elsewhere in the codebase
3. Apply fixes that match the project's style
4. Run verification after fixes: Use the project's test/lint commands

## Quick Fixes

For ${projectType} projects:
${this.getQuickFixes(projectType)}
`;

    return {
      name,
      description: 'Fixes common errors in this codebase',
      reason: `${topError.count}x ${topError.pattern} errors`,
      focus: ['error patterns', 'quick fixes'],
      markdown
    };
  }

  private suggestContextAgent(loops: LoopPattern[]): AgentSuggestion | null {
    if (loops.length === 0) return null;

    const topLoop = loops[0];
    const threshold = getThreshold('context-keeper');
    if (topLoop.readCount < threshold) return null; // Not enough reads

    const name = 'context-keeper';
    const fileList = loops.slice(0, 5).map(l => `- ${l.fileName} (read ${l.readCount}x)`).join('\n');
    const fullPaths = loops.slice(0, 5).map(l => l.file);

    const markdown = `---
name: ${name}
description: Maintains context about frequently accessed files
tools: Read, Grep
model: haiku
---

# Context Keeper Agent

You maintain knowledge about files that are frequently referenced in this project.

## Key Files You Track

${fileList}

## Full Paths

${fullPaths.map(f => `- ${f}`).join('\n')}

## Your Role

1. You remember the contents and structure of these key files
2. When asked about them, provide accurate information without re-reading
3. Alert when changes might affect these core files
4. Use haiku model to save tokens since you're just retrieving cached context

## Usage

Call this agent when you need quick context about these files instead of re-reading them.
`;

    return {
      name,
      description: 'Caches context for frequently read files',
      reason: `${topLoop.fileName} read ${topLoop.readCount}x`,
      focus: fullPaths,
      markdown
    };
  }

  private suggestLanguageAgent(
    projectType: 'go' | 'node' | 'rust' | 'python' | 'unknown',
    fileTypes: { ext: string; editCount: number }[]
  ): AgentSuggestion | null {
    if (projectType === 'unknown') return null;

    const langConfig = this.getLanguageConfig(projectType);
    const name = `${projectType}-specialist`;

    const markdown = `---
name: ${name}
description: ${langConfig.description}
tools: Read, Grep, Edit, Bash
---

# ${langConfig.title} Specialist Agent

You are an expert in ${langConfig.language} development for this project.

## Commands You Know

- **Build**: \`${langConfig.buildCmd}\`
- **Test**: \`${langConfig.testCmd}\`
- **Lint**: \`${langConfig.lintCmd}\`
- **Type Check**: \`${langConfig.checkCmd}\`

## Best Practices

${langConfig.bestPractices.map(p => `- ${p}`).join('\n')}

## Common Patterns in This Project

Based on file activity:
${fileTypes.slice(0, 5).map(f => `- ${f.ext}: ${f.editCount} edits`).join('\n')}

## Your Approach

1. Follow ${langConfig.language} idioms and conventions
2. Run appropriate checks after changes
3. Keep code consistent with project style
`;

    return {
      name,
      description: langConfig.description,
      reason: `Project detected as ${projectType}`,
      focus: [langConfig.language, 'best practices'],
      markdown
    };
  }

  private suggestQualityAgent(
    hotspots: QualityHotspot[],
    failedChecks: FailedCheckSummary[],
    projectType: string
  ): AgentSuggestion | null {
    if (failedChecks.length === 0) return null;

    const name = 'quality-guard';
    const topChecks = failedChecks.slice(0, 3);
    const checkList = topChecks.map(c => `- ${c.name} (${c.count}x)`).join('\n');
    const hotspotList = hotspots.slice(0, 5).map(h => `- ${h.target} (${h.count} failures)`).join('\n');

    const markdown = `---
name: ${name}
description: Focused on fixing failing verification checks
tools: Read, Grep, Edit, Bash
---

# Quality Guard Agent

You specialize in improving code quality by fixing failing checks in this ${projectType} project.

## Failing Checks

${checkList}

## Failure Hotspots

${hotspotList}

## Your Approach

1. Identify the failing checks and their root causes
2. Focus on hotspot folders first
3. Apply fixes that align with project conventions
4. Re-run verification after each fix
`;

    return {
      name,
      description: 'Fixes failing verification checks',
      reason: `${topChecks[0]?.count || 1}x ${topChecks[0]?.name || 'check'} failures`,
      focus: hotspots.slice(0, 5).map(h => h.target),
      markdown
    };
  }

  private suggestRegressionAgent(
    failedChecks: FailedCheckSummary[],
    projectType: string
  ): AgentSuggestion | null {
    const regressions = failedChecks.filter(c => c.regressions > 0);
    if (regressions.length === 0) return null;

    const name = 'regression-fixer';
    const regressionList = regressions.slice(0, 3).map(c => `- ${c.name} (${c.regressions} regressions)`).join('\n');

    const markdown = `---
name: ${name}
description: Targets regressions in verification checks
tools: Read, Grep, Edit, Bash
---

# Regression Fixer Agent

You focus on regressions: checks that used to pass but now fail in this ${projectType} project.

## Regressed Checks

${regressionList}

## Your Approach

1. Find the last known passing state (recent edits)
2. Isolate changes linked to the regression
3. Restore correctness without adding fallbacks
4. Verify immediately after fixing
`;

    return {
      name,
      description: 'Fixes regressions in verification checks',
      reason: `${regressions[0]?.regressions || 1} regressions detected`,
      focus: regressions.map(r => r.name),
      markdown
    };
  }

  private getLanguageConfig(projectType: string) {
    const configs: Record<string, {
      title: string;
      language: string;
      description: string;
      buildCmd: string;
      testCmd: string;
      lintCmd: string;
      checkCmd: string;
      bestPractices: string[];
    }> = {
      go: {
        title: 'Go',
        language: 'Go',
        description: 'Go development specialist',
        buildCmd: 'go build ./...',
        testCmd: 'go test ./...',
        lintCmd: 'golangci-lint run',
        checkCmd: 'go vet ./...',
        bestPractices: [
          'Use interfaces for abstraction',
          'Handle errors explicitly',
          'Keep functions small and focused',
          'Use table-driven tests',
          'Avoid global state'
        ]
      },
      node: {
        title: 'Node.js/TypeScript',
        language: 'TypeScript',
        description: 'TypeScript development specialist',
        buildCmd: 'bun run build',
        testCmd: 'bun test',
        lintCmd: 'bun run lint',
        checkCmd: 'bun run typecheck',
        bestPractices: [
          'Use strict TypeScript settings',
          'Prefer interfaces over types for objects',
          'Use async/await over callbacks',
          'Keep dependencies minimal',
          'Write unit tests for business logic'
        ]
      },
      rust: {
        title: 'Rust',
        language: 'Rust',
        description: 'Rust development specialist',
        buildCmd: 'cargo build',
        testCmd: 'cargo test',
        lintCmd: 'cargo clippy',
        checkCmd: 'cargo check',
        bestPractices: [
          'Use Result for error handling',
          'Prefer owned types unless borrowing is needed',
          'Use iterators over loops',
          'Keep unsafe blocks minimal',
          'Document public APIs'
        ]
      },
      python: {
        title: 'Python',
        language: 'Python',
        description: 'Python development specialist',
        buildCmd: 'python -m build',
        testCmd: 'pytest',
        lintCmd: 'ruff check',
        checkCmd: 'mypy .',
        bestPractices: [
          'Use type hints',
          'Follow PEP 8 style',
          'Use virtual environments',
          'Write docstrings',
          'Prefer composition over inheritance'
        ]
      }
    };

    return configs[projectType] || configs.node;
  }

  private getQuickFixes(projectType: string): string {
    const fixes: Record<string, string> = {
      go: `- Type errors: Check interface implementations
- Import errors: Run \`goimports\`
- Vet warnings: Address them before committing`,
      node: `- Type errors: Check for missing type definitions
- Import errors: Verify package.json dependencies
- Lint errors: Run \`bun run lint\``,
      rust: `- Borrow checker: Consider using clone() or restructuring
- Missing traits: Check derive macros
- Lifetime errors: Simplify lifetimes where possible`,
      python: `- Type errors: Add type annotations
- Import errors: Check virtual environment
- Lint errors: Run \`ruff check --fix\``
    };

    return fixes[projectType] || fixes.node;
  }

  private appendUserContext(markdown: string, userContext: string): string {
    return markdown + `\n## Additional Context\n\n${userContext}\n`;
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

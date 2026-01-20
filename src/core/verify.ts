import { exec } from 'child_process';
import { promisify } from 'util';
import { logVerifyResult, updateMetric, VerifyResult, getChangedFiles, getLastVerifyResult, logQualityEvent } from './storage';
import { getConfig, Config } from './config';
import { SecurityManager } from './security';

const execAsync = promisify(exec);

export interface CheckResult {
  name: string;
  command: string;
  passed: boolean;
  output?: string;
  duration_ms: number;
  label?: string;
}

/**
 * Build a targeted command that only checks specific files
 * Returns null if targeting isn't possible for this command
 */
function buildTargetedCommand(name: string, baseCommand: string, changedFiles: string[]): string | null {
  if (changedFiles.length === 0) return null;

  // Filter to only source files (not config, json, etc.)
  const sourceFiles = changedFiles.filter(f =>
    f.endsWith('.ts') || f.endsWith('.tsx') ||
    f.endsWith('.js') || f.endsWith('.jsx') ||
    f.endsWith('.go') || f.endsWith('.py') || f.endsWith('.rs')
  );

  if (sourceFiles.length === 0) return null;

  // Lint: most linters accept file paths
  if (name === 'lint') {
    // ESLint: bunx eslint file1.ts file2.ts
    if (baseCommand.includes('eslint') || baseCommand.includes('bun run lint')) {
      const files = sourceFiles.join(' ');
      return `bunx eslint ${files}`;
    }
    // golangci-lint: golangci-lint run file1.go file2.go
    if (baseCommand.includes('golangci-lint')) {
      const goFiles = sourceFiles.filter(f => f.endsWith('.go')).join(' ');
      return goFiles ? `golangci-lint run ${goFiles}` : null;
    }
    // ruff: ruff check file1.py file2.py
    if (baseCommand.includes('ruff')) {
      const pyFiles = sourceFiles.filter(f => f.endsWith('.py')).join(' ');
      return pyFiles ? `ruff check ${pyFiles}` : null;
    }
  }

  // Test: try to find related test files
  if (name === 'test') {
    // For now, run full tests - finding related tests is complex
    // Future: could use jest --findRelatedTests or similar
    return null;
  }

  // Typecheck: needs full project context
  // TypeScript needs all files to check types correctly
  if (name === 'typecheck' || name === 'build') {
    return null;
  }

  return null;
}

export async function runVerification(mode: 'full' | 'fast' = 'full'): Promise<VerifyResult> {
  const config = await getConfig();
  const checks: CheckResult[] = [];
  const startTime = Date.now();
  const previousResult = getLastVerifyResult();

  // Get files changed in this session for targeted verification
  const changedFiles = getChangedFiles();
  const hasChangedFiles = changedFiles.length > 0;

  // Run configured checks
  if (mode === 'fast') {
    // Fast mode: only typecheck and lint
    if (config.verifiers.typecheck) {
      checks.push(await runCheck('typecheck', config.verifiers.typecheck, config.fastVerifyTimeout));
    }
    if (config.verifiers.lint) {
      // Try targeted lint on changed files only
      const targetedCmd = hasChangedFiles
        ? buildTargetedCommand('lint', config.verifiers.lint, changedFiles)
        : null;
      const cmd = targetedCmd || config.verifiers.lint;
      const label = targetedCmd ? `lint (${changedFiles.length} files)` : undefined;
      checks.push(await runCheck('lint', cmd, config.fastVerifyTimeout, label));
    }
  } else {
    // Full mode: run all checks, but target lint to changed files
    for (const [name, command] of Object.entries(config.verifiers)) {
      if (!command) continue;

      // Try to target lint to changed files
      if (name === 'lint' && hasChangedFiles) {
        const targetedCmd = buildTargetedCommand('lint', command, changedFiles);
        if (targetedCmd) {
          const label = `lint (${changedFiles.length} files)`;
          checks.push(await runCheck('lint', targetedCmd, config.verifyTimeout, label));
          continue;
        }
      }

      // Run full command for other checks
      checks.push(await runCheck(name, command, config.verifyTimeout));
    }
  }

  const result: VerifyResult = {
    mode,
    checks,
    allPassing: checks.every(c => c.passed),
    duration_ms: Date.now() - startTime
  };

  const regressionSet = buildRegressionSet(checks, previousResult);
  logQualityFailures(checks, changedFiles, regressionSet);

  // Log the result
  logVerifyResult(result);
  updateMetric('verify_runs');

  return result;
}

async function runCheck(
  name: string,
  command: string,
  timeoutSeconds: number,
  label?: string
): Promise<CheckResult> {
  const startTime = Date.now();
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutSeconds * 1000,
      encoding: 'utf8'
    });
    
    return {
      name,
      command,
      passed: true,
      output: stdout || stderr,
      duration_ms: Date.now() - startTime,
      label
    };
  } catch (error: any) {
    return {
      name,
      command,
      passed: false,
      output: error.message || error.toString(),
      duration_ms: Date.now() - startTime,
      label
    };
  }
}

export async function runFastVerify(config: Config): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  
  // Typecheck (fast, usually <5s)
  if (config.verifiers.typecheck) {
    results.push(await runCheck('typecheck', config.verifiers.typecheck, config.fastVerifyTimeout));
  }
  
  // Lint (fast, usually <3s)
  if (config.verifiers.lint) {
    results.push(await runCheck('lint', config.verifiers.lint, config.fastVerifyTimeout));
  }
  
  // NOTE: No tests here - they run on Stop or manual trigger
  
  return results;
}

export function formatVerifyResult(result: VerifyResult): string {
  const lines: string[] = ['📋 Verification Results\n'];
  
  for (const check of result.checks) {
    const icon = check.passed ? '✅' : '❌';
    const time = `(${(check.duration_ms / 1000).toFixed(1)}s)`;
    const label = check.label || check.name;
    lines.push(`${icon} ${label} ${time}`);
    
    if (!check.passed && check.output) {
      // Show first few lines of error output
      const errorLines = check.output.split('\n').slice(0, 3);
      for (const line of errorLines) {
        lines.push(`   ${line}`);
      }
      if (check.output.split('\n').length > 3) {
        lines.push('   ...');
      }
    }
  }
  
  lines.push(`\n⏱️  Total time: ${(result.duration_ms / 1000).toFixed(1)}s`);
  
  if (!result.allPassing) {
    lines.push('\n❌ Some checks failed. Fix the issues before proceeding.');
  } else {
    lines.push('\n✅ All checks passed!');
  }
  
  return lines.join('\n');
}

export function detectRegression(current: CheckResult[], previous: VerifyResult | null): string | null {
  if (!previous) return null;
  
  // Check if any previously passing check now fails
  for (const check of current) {
    if (!check.passed) {
      const prevCheck = previous.checks.find(c => c.name === check.name);
      if (prevCheck && prevCheck.passed) {
        return `Regression detected: ${check.name} was passing but now fails`;
      }
    }
  }
  
  return null;
}

function buildRegressionSet(current: CheckResult[], previous: VerifyResult | null): Set<string> {
  const regressions = new Set<string>();
  if (!previous) return regressions;

  for (const check of current) {
    if (!check.passed) {
      const prevCheck = previous.checks.find(c => c.name === check.name);
      if (prevCheck && prevCheck.passed) {
        regressions.add(check.name);
      }
    }
  }

  return regressions;
}

function redactOutputSummary(output?: string): string | undefined {
  if (!output) return undefined;
  const trimmed = output.slice(0, 200);
  const sensitive = SecurityManager.checkContentForSensitiveData(trimmed);
  if (sensitive.hasSensitiveData) {
    return '[redacted]';
  }
  return trimmed;
}

function logQualityFailures(
  checks: CheckResult[],
  changedFiles: string[],
  regressionSet: Set<string>
): void {
  const failedChecks = checks.filter(c => !c.passed);
  if (failedChecks.length === 0) return;

  for (const check of failedChecks) {
    logQualityEvent({
      checkName: check.name,
      passed: check.passed,
      outputSummary: redactOutputSummary(check.output),
      changedFiles,
      isRegression: regressionSet.has(check.name),
      timestamp: Date.now()
    });
  }
}
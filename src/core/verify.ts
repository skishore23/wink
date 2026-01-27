import { exec } from 'child_process';
import { promisify } from 'util';
import { logVerifyResult, updateMetric, VerifyResult, getChangedFiles, getLastVerifyResult, logQualityEvent, getBaseline, setBaseline } from './storage';
import { getConfig, Config } from './config';
import { SecurityManager } from './security';

const execAsync = promisify(exec);

// File type patterns
const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|go|py|rs|java|cpp|c|h|swift|kt|rb|php)$/;
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$|_test\.go$|test_.*\.py$|.*_test\.rb$/;
const CONFIG_FILE_PATTERN = /\.(json|yaml|yml|toml|ini|env)$/;
const DOC_FILE_PATTERN = /\.(md|txt|rst|adoc)$/;

/**
 * Determine if a check should run based on changed files
 * Returns: { run: boolean, reason?: string }
 */
function shouldRunCheck(checkName: string, changedFiles: string[]): { run: boolean; reason?: string } {
  // If no changes tracked, run all checks (manual /verify)
  if (changedFiles.length === 0) {
    return { run: true };
  }

  const hasCodeFiles = changedFiles.some(f => CODE_FILE_PATTERN.test(f));
  const hasTestFiles = changedFiles.some(f => TEST_FILE_PATTERN.test(f));
  const hasOnlyDocs = changedFiles.every(f => DOC_FILE_PATTERN.test(f));
  const hasOnlyConfig = changedFiles.every(f => CONFIG_FILE_PATTERN.test(f) || DOC_FILE_PATTERN.test(f));

  switch (checkName) {
    case 'typecheck':
      if (hasOnlyDocs) return { run: false, reason: 'only docs changed' };
      if (!hasCodeFiles && hasOnlyConfig) return { run: false, reason: 'only config changed' };
      return { run: true };

    case 'build':
      if (hasOnlyDocs) return { run: false, reason: 'only docs changed' };
      return { run: true };

    case 'test':
      if (hasOnlyDocs) return { run: false, reason: 'only docs changed' };
      if (!hasCodeFiles && !hasTestFiles) return { run: false, reason: 'no code changes' };
      return { run: true };

    case 'lint':
      // Lint can run on more file types
      if (hasOnlyDocs) return { run: false, reason: 'only docs changed' };
      return { run: true };

    case 'security':
      // Security checks should always run if there are code changes
      if (hasOnlyDocs) return { run: false, reason: 'only docs changed' };
      return { run: true };

    default:
      return { run: true };
  }
}

export interface CheckResult {
  name: string;
  command: string;
  passed: boolean;
  output?: string;
  duration_ms: number;
  label?: string;
}

/**
 * Build a targeted lint command for specific files
 * Tests are left to Claude to scope intelligently based on context
 */
function buildTargetedLintCommand(baseCommand: string, changedFiles: string[]): string | null {
  if (changedFiles.length === 0) return null;

  // Filter to only source files
  const sourceFiles = changedFiles.filter(f =>
    f.endsWith('.ts') || f.endsWith('.tsx') ||
    f.endsWith('.js') || f.endsWith('.jsx') ||
    f.endsWith('.go') || f.endsWith('.py') || f.endsWith('.rs')
  );

  if (sourceFiles.length === 0) return null;

  // ESLint
  if (baseCommand.includes('eslint') || baseCommand.includes('bun run lint')) {
    return `bunx eslint ${sourceFiles.join(' ')}`;
  }
  // golangci-lint
  if (baseCommand.includes('golangci-lint')) {
    const goFiles = sourceFiles.filter(f => f.endsWith('.go')).join(' ');
    return goFiles ? `golangci-lint run ${goFiles}` : null;
  }
  // ruff
  if (baseCommand.includes('ruff')) {
    const pyFiles = sourceFiles.filter(f => f.endsWith('.py')).join(' ');
    return pyFiles ? `ruff check ${pyFiles}` : null;
  }

  return null;
}

export interface SkippedCheck {
  name: string;
  reason: string;
}

export interface ExtendedVerifyResult extends VerifyResult {
  skipped?: SkippedCheck[];
  baseline?: Map<string, boolean>;
}

export async function runVerification(mode: 'full' | 'fast' = 'full'): Promise<ExtendedVerifyResult> {
  const config = await getConfig();
  const checks: CheckResult[] = [];
  const skipped: SkippedCheck[] = [];
  const startTime = Date.now();
  const previousResult = getLastVerifyResult();

  // Get files changed in this session for targeted verification
  const changedFiles = getChangedFiles();
  const hasChangedFiles = changedFiles.length > 0;

  // Get or capture baseline (first verify of session establishes baseline)
  let baseline = getBaseline();
  const isFirstVerify = baseline === null;

  // Run configured checks
  if (mode === 'fast') {
    // Fast mode: only typecheck and lint
    if (config.verifiers.typecheck) {
      const shouldRun = shouldRunCheck('typecheck', changedFiles);
      if (shouldRun.run) {
        checks.push(await runCheck('typecheck', config.verifiers.typecheck, config.fastVerifyTimeout));
      } else if (shouldRun.reason) {
        skipped.push({ name: 'typecheck', reason: shouldRun.reason });
      }
    }
    if (config.verifiers.lint) {
      const shouldRun = shouldRunCheck('lint', changedFiles);
      if (shouldRun.run) {
        // Try targeted lint on changed files only
        const targetedCmd = hasChangedFiles
          ? buildTargetedLintCommand(config.verifiers.lint, changedFiles)
          : null;
        const cmd = targetedCmd || config.verifiers.lint;
        const label = targetedCmd ? `lint (${changedFiles.length} files)` : undefined;
        checks.push(await runCheck('lint', cmd, config.fastVerifyTimeout, label));
      } else if (shouldRun.reason) {
        skipped.push({ name: 'lint', reason: shouldRun.reason });
      }
    }
  } else {
    // Full mode: run all checks, target lint to changed files
    for (const [name, command] of Object.entries(config.verifiers)) {
      if (!command) continue;

      // Check if this check should run based on changed files
      const shouldRun = shouldRunCheck(name, changedFiles);
      if (!shouldRun.run) {
        if (shouldRun.reason) {
          skipped.push({ name, reason: shouldRun.reason });
        }
        continue;
      }

      // Only lint gets auto-scoped, tests are left for Claude to handle intelligently
      if (name === 'lint' && hasChangedFiles && config.features.fileSpecificChecks) {
        const targetedCmd = buildTargetedLintCommand(command, changedFiles);
        if (targetedCmd) {
          const label = `lint (${changedFiles.length} files)`;
          checks.push(await runCheck(name, targetedCmd, config.verifyTimeout, label));
          continue;
        }
      }

      // Run full command for tests, typecheck, build, etc.
      checks.push(await runCheck(name, command, config.verifyTimeout));
    }
  }

  // Capture baseline on first verify
  if (isFirstVerify && checks.length > 0) {
    setBaseline(checks.map(c => ({ name: c.name, passed: c.passed })));
    baseline = getBaseline();
  }

  const result: ExtendedVerifyResult = {
    mode,
    checks,
    allPassing: checks.every(c => c.passed),
    duration_ms: Date.now() - startTime,
    skipped: skipped.length > 0 ? skipped : undefined,
    baseline: baseline || undefined
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

export function formatVerifyResult(result: ExtendedVerifyResult): string {
  const lines: string[] = ['📋 Verification Results\n'];

  // Show executed checks
  for (const check of result.checks) {
    const icon = check.passed ? '✅' : '❌';
    const time = `(${(check.duration_ms / 1000).toFixed(1)}s)`;
    const label = check.label || check.name;

    // Check if this is a baseline failure (was already failing at session start)
    let baselineNote = '';
    if (!check.passed && result.baseline) {
      const wasPassingAtStart = result.baseline.get(check.name);
      if (wasPassingAtStart === false) {
        baselineNote = ' [pre-existing]';
      } else if (wasPassingAtStart === true) {
        baselineNote = ' [regression]';
      }
    }

    lines.push(`${icon} ${label} ${time}${baselineNote}`);

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

  // Show skipped checks
  if (result.skipped && result.skipped.length > 0) {
    lines.push('');
    for (const skip of result.skipped) {
      lines.push(`⏭️  ${skip.name} skipped (${skip.reason})`);
    }
  }

  lines.push(`\n⏱️  Total time: ${(result.duration_ms / 1000).toFixed(1)}s`);

  if (!result.allPassing) {
    // Check if all failures are pre-existing (not regressions)
    const hasRegressions = result.checks.some(c => {
      if (c.passed) return false;
      if (!result.baseline) return true;
      return result.baseline.get(c.name) === true; // was passing, now failing
    });

    if (hasRegressions) {
      lines.push('\n❌ Regressions detected. Fix the issues before proceeding.');
    } else {
      lines.push('\n⚠️  Some checks failing (pre-existing). No new regressions.');
    }
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


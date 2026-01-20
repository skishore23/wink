import { getProjectRoot } from '../core/config';
import { DebugLogger } from '../core/debug';

// Re-export centralized utilities from hookRunner
export {
  readStdin,
  parseStdinAs,
  runHook,
  runPreToolUse,
  runPostToolUse,
  runStopGate,
  runUserPromptSubmit,
  runSessionStart,
  safeJsonParse,
  extractErrorFromResponse
} from '../core/hookRunner';

// Shared ANSI colors - use for stderr output (terminal renders these)
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

// Extract file path from various tool input formats
export function extractFilePath(toolName: string, toolInput: Record<string, unknown>): string | null {
  if (toolName === 'MultiEdit' && toolInput.edits) {
    return (toolInput.file_path as string) || null;
  }
  return (toolInput.file_path as string) || (toolInput.path as string) || null;
}

export async function readHookInput<T = unknown>(): Promise<T> {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return JSON.parse(input);
}

export function outputHookResult(output: unknown): void {
  console.log(JSON.stringify(output));
}

export function outputEmpty(): void {
  console.log(JSON.stringify({}));
}

export async function withErrorHandling(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // Always fail silently and allow operation
    outputEmpty();
    process.exit(0);
  }
}

export function getDebugLogger(): DebugLogger {
  return new DebugLogger(getProjectRoot());
}

export async function logDebugContext(hookName: string, context: string): Promise<void> {
  const logger = getDebugLogger();
  await logger.logAdditionalContext(hookName, context);
}

export async function logDebugDecision(hookName: string, decision: any): Promise<void> {
  const logger = getDebugLogger();
  await logger.logDecision(hookName, JSON.stringify(decision));
}
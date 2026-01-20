import type {
  PreToolUseOutput,
  PostToolUseOutput,
  StopGateOutput,
  UserPromptSubmitOutput,
  HookResult
} from '../types/hooks';
import { DebugLogger } from './debug';

const logger = new DebugLogger();

function debugLog(type: string, message: string): void {
  logger.log({
    timestamp: new Date(),
    type: 'decision',
    hookName: type,
    content: message
  }).catch(() => {});
}

export async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return chunks.join('');
}

export async function parseStdinAs<T>(): Promise<T> {
  const data = await readStdin();
  return JSON.parse(data) as T;
}

export async function runHook<T extends HookResult>(
  hookFn: () => Promise<T>,
  defaultOnError: T
): Promise<void> {
  try {
    const result = await hookFn();
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (error) {
    // Log error for debugging but don't expose to user
    debugLog('hook-error', `Hook error: ${error instanceof Error ? error.message : String(error)}`);
    if (process.env.WINK_DEBUG) {
      console.error(`[wink-debug] Hook error:`, error);
    }
    // Return safe default - never break Claude's flow
    console.log(JSON.stringify(defaultOnError));
    process.exit(0);
  }
}

export async function runPreToolUse(
  hookFn: () => Promise<PreToolUseOutput>
): Promise<void> {
  await runHook(hookFn, { decision: 'approve' });
}

export async function runPostToolUse(
  hookFn: () => Promise<PostToolUseOutput>
): Promise<void> {
  await runHook(hookFn, {});
}

export async function runStopGate(
  hookFn: () => Promise<StopGateOutput>
): Promise<void> {
  await runHook(hookFn, { decision: 'approve' });
}

export async function runUserPromptSubmit(
  hookFn: () => Promise<UserPromptSubmitOutput>
): Promise<void> {
  await runHook(hookFn, {});
}

export async function runSessionStart(
  hookFn: () => Promise<void>
): Promise<void> {
  try {
    await hookFn();
    console.log(JSON.stringify({}));
    process.exit(0);
  } catch (error) {
    debugLog('session-start-error', `Session start error: ${error instanceof Error ? error.message : String(error)}`);
    if (process.env.WINK_DEBUG) {
      console.error(`[wink-debug] Session start error:`, error);
    }
    console.log(JSON.stringify({}));
    process.exit(0);
  }
}

export function safeJsonParse<T>(data: string, fallback: T): T {
  try {
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

export function extractErrorFromResponse(response: unknown): string | null {
  if (typeof response === 'string') {
    // Check for common error patterns
    const lowerResponse = response.toLowerCase();
    if (lowerResponse.includes('error') ||
        lowerResponse.includes('failed') ||
        lowerResponse.includes('exception') ||
        lowerResponse.includes('enoent') ||
        lowerResponse.includes('permission denied')) {
      return response.slice(0, 500); // Limit error length
    }
    return null;
  }

  if (typeof response === 'object' && response !== null) {
    const obj = response as Record<string, unknown>;
    if (obj.error) return String(obj.error);
    if (obj.stderr && typeof obj.stderr === 'string' && obj.stderr.length > 0) {
      return obj.stderr.slice(0, 500);
    }
  }

  return null;
}

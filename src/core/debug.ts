import * as fs from 'fs';
import * as path from 'path';

export interface DebugEvent {
  timestamp: Date;
  type: 'context_injection' | 'additional_context' | 'decision';
  hookName: string;
  content: string;
}

export class DebugLogger {
  private debugPath: string;
  private enabled: boolean;

  constructor(workingDir: string = process.cwd()) {
    this.debugPath = path.join(workingDir, '.wink', 'debug.log');
    this.enabled = process.env.WINK_DEBUG === 'true';
  }

  async log(event: DebugEvent): Promise<void> {
    if (!this.enabled) return;

    const logEntry = {
      ...event,
      timestamp: new Date().toISOString()
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    try {
      await fs.promises.mkdir(path.dirname(this.debugPath), { recursive: true });
      await fs.promises.appendFile(this.debugPath, logLine);
    } catch {
      // Silently fail - debug logging should never break the flow
    }
  }

  async logContextInjection(hookName: string, content: string): Promise<void> {
    await this.log({
      timestamp: new Date(),
      type: 'context_injection',
      hookName,
      content
    });
  }

  async logAdditionalContext(hookName: string, content: string): Promise<void> {
    await this.log({
      timestamp: new Date(),
      type: 'additional_context',
      hookName,
      content
    });
  }

  async logDecision(hookName: string, content: string): Promise<void> {
    await this.log({
      timestamp: new Date(),
      type: 'decision',
      hookName,
      content
    });
  }
}
// Modern, subtle activity reporting for wink
// Note: No ANSI colors - Claude Code displays them as raw text

export class ActivityReporter {

  // Subtle one-line format: ○ wink · message
  static format(message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info'): string {
    const icons = { info: '○', success: '✓', warn: '!', error: '✗' };
    return `${icons[type]} wink · ${message}`;
  }

  static report(activity: string, details?: string): string | null {
    const msg = details ? `${activity}: ${details}` : activity;
    return this.format(msg);
  }

  static reportContextInjection(itemsAdded: number): string | null {
    if (itemsAdded === 0) return null;
    return this.format(`context +${itemsAdded} items`);
  }

  static reportChecksStarting(checkNames: string[]): string | null {
    return this.format(`running ${checkNames.join(', ')}`);
  }

  static reportCheckResults(passed: number, failed: number): string | null {
    if (failed === 0) {
      return this.format(`${passed} checks passed`, 'success');
    }
    return this.format(`${failed} failed, ${passed} passed`, 'error');
  }

  static reportToolRunning(toolName: string, description?: string): string | null {
    return this.format(`${toolName}${description ? `: ${description}` : ''}`);
  }

  static reportFileActivity(action: 'read' | 'edit' | 'analyze', fileName: string): string | null {
    return this.format(`${action} ${fileName}`);
  }

  // For verification failures - slightly more prominent but still clean
  static reportVerificationFailure(file: string, failures: Array<{name: string; error?: string}>): string {
    let msg = `\n✗ wink verification\n`;
    msg += `  file: ${file}\n`;
    for (const f of failures) {
      msg += `  ✗ ${f.name}${f.error ? `: ${f.error}` : ''}\n`;
    }
    return msg;
  }

  static reportVerificationSuccess(file: string): string {
    return `✓ wink · verified ${file}`;
  }
}

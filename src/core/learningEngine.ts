/**
 * Learning Engine
 *
 * Simple data aggregation for session analysis.
 * No automatic adjustments - exposes raw data for Claude to analyze.
 */

import { getErrorSummary } from './errorLearning';
import { getThresholds, ThresholdConfig } from './thresholdManager';

export interface LearningReport {
  // Error data
  errorSummary: Array<{ category: string; count: number }>;

  // Current thresholds (static, not auto-adjusted)
  thresholds: ThresholdConfig[];

  // Simple insights based on data
  insights: string[];
}

/**
 * Generate a learning report with raw data for Claude to analyze
 */
export function generateLearningReport(): LearningReport {
  const insights: string[] = [];

  // Get error summary
  const errorSummary = getErrorSummary();

  if (errorSummary.length > 0) {
    const topError = errorSummary[0];
    insights.push(`Most common error type: ${topError.category} (${topError.count} occurrences)`);
  }

  // Get current thresholds
  const thresholds = getThresholds();

  return {
    errorSummary,
    thresholds,
    insights
  };
}

/**
 * Get learning status summary
 */
export function getLearningStatus(): {
  hasData: boolean;
  errorCount: number;
} {
  const errors = getErrorSummary();
  const totalErrors = errors.reduce((sum, e) => sum + e.count, 0);

  return {
    hasData: totalErrors > 0,
    errorCount: totalErrors
  };
}

/**
 * Format learning report for display
 */
export function formatLearningReport(report: LearningReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('\x1b[1mlearning data\x1b[0m');
  lines.push('');

  // Error summary
  if (report.errorSummary.length > 0) {
    lines.push('  \x1b[1merrors by category\x1b[0m');
    for (const error of report.errorSummary.slice(0, 5)) {
      lines.push(`    ${error.category}: ${error.count}`);
    }
  } else {
    lines.push('  \x1b[2mno errors recorded\x1b[0m');
  }

  // Current thresholds
  lines.push('');
  lines.push('  \x1b[1mcurrent thresholds\x1b[0m');
  for (const threshold of report.thresholds) {
    lines.push(`    ${threshold.agentType}: ${threshold.thresholdValue}`);
  }

  // Insights
  if (report.insights.length > 0) {
    lines.push('');
    lines.push('  \x1b[1minsights\x1b[0m');
    for (const insight of report.insights) {
      lines.push(`    • ${insight}`);
    }
  }

  lines.push('');

  return lines.join('\n');
}

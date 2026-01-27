/**
 * Threshold Manager
 *
 * Simple threshold configuration for agent suggestions.
 * Thresholds are static values - Claude analyzes data and suggests changes.
 */

export interface ThresholdConfig {
  agentType: string;
  thresholdValue: number;
}

/**
 * Default thresholds for agent types
 */
const DEFAULT_THRESHOLDS: Record<string, number> = {
  'folder-expert': 20,
  'error-fixer': 3,
  'context-keeper': 5,
  'language-specialist': 1,
  'quality-guard': 1,
  'regression-fixer': 1
};

/**
 * Get the current threshold for an agent type
 */
export function getThresholdSync(agentType: string): number {
  return DEFAULT_THRESHOLDS[agentType] ?? 10;
}

/**
 * Get all threshold configurations
 */
export function getThresholds(): ThresholdConfig[] {
  return Object.entries(DEFAULT_THRESHOLDS).map(([agentType, thresholdValue]) => ({
    agentType,
    thresholdValue
  }));
}

/**
 * Check if an agent type should be suggested based on current metrics
 */
export function shouldSuggestAgent(
  agentType: string,
  currentMetric: number
): { suggest: boolean; reason?: string } {
  const threshold = getThresholdSync(agentType);

  if (currentMetric >= threshold) {
    return { suggest: true };
  }

  return {
    suggest: false,
    reason: `metric ${currentMetric} below threshold ${threshold}`
  };
}

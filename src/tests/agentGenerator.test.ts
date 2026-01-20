import { describe, it, expect, beforeEach } from 'vitest';
import { AgentGenerator, AgentSuggestion } from '../core/agentGenerator';
import { SessionInsights } from '../core/sessionAnalyzer';
import { resetThreshold } from '../core/thresholdManager';

describe('AgentGenerator', () => {
  const generator = new AgentGenerator();

  beforeEach(() => {
    // Reset thresholds to defaults to avoid cross-test pollution
    resetThreshold('folder-expert');
    resetThreshold('error-fixer');
    resetThreshold('context-keeper');
  });

  function createMockInsights(overrides: Partial<SessionInsights> = {}): SessionInsights {
    return {
      hotFolders: [],
      commonErrors: [],
      toolFrequency: [],
      fileTypes: [],
      loopPatterns: [],
      qualityHotspots: [],
      failedChecks: [],
      projectType: 'node',
      totalEvents: 100,
      totalEdits: 50,
      totalReads: 50,
      sessionDuration: 60,
      ...overrides
    };
  }

  describe('generate()', () => {
    it('returns empty array when no patterns detected and unknown project type', () => {
      const insights = createMockInsights({ projectType: 'unknown' });
      const suggestions = generator.generate(insights);

      expect(suggestions).toEqual([]);
    });

    it('returns only language specialist when project type is known but no other patterns', () => {
      const insights = createMockInsights(); // defaults to 'node'
      const suggestions = generator.generate(insights);

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].name).toBe('node-specialist');
    });

    it('generates hot folder agent when edit count >= threshold', () => {
      const insights = createMockInsights({
        hotFolders: [
          { path: '/project/src/hooks', editCount: 25, readCount: 5 }
        ]
      });

      const suggestions = generator.generate(insights);

      expect(suggestions.length).toBeGreaterThanOrEqual(1);
      const hotFolderAgent = suggestions.find(s => s.name === 'hooks-expert');
      expect(hotFolderAgent).toBeDefined();
      expect(hotFolderAgent?.reason).toContain('25 edits');
    });

    it('skips hot folder agent when edit count < 5', () => {
      const insights = createMockInsights({
        hotFolders: [
          { path: '/project/src/hooks', editCount: 3, readCount: 5 }
        ]
      });

      const suggestions = generator.generate(insights);
      const hotFolderAgent = suggestions.find(s => s.name.includes('-expert'));

      expect(hotFolderAgent).toBeUndefined();
    });

    it('generates error fixer agent when error count >= 3', () => {
      const insights = createMockInsights({
        commonErrors: [
          { pattern: 'TypeScript type mismatch', count: 5, lastSeen: Date.now(), examples: ['error 1'] }
        ]
      });

      const suggestions = generator.generate(insights);

      const errorAgent = suggestions.find(s => s.name === 'error-fixer');
      expect(errorAgent).toBeDefined();
      expect(errorAgent?.reason).toContain('5x');
    });

    it('skips error fixer agent when error count < 3', () => {
      const insights = createMockInsights({
        commonErrors: [
          { pattern: 'TypeScript type mismatch', count: 2, lastSeen: Date.now(), examples: [] }
        ]
      });

      const suggestions = generator.generate(insights);
      const errorAgent = suggestions.find(s => s.name === 'error-fixer');

      expect(errorAgent).toBeUndefined();
    });

    it('generates context keeper agent when read count >= 4', () => {
      const insights = createMockInsights({
        loopPatterns: [
          { file: '/project/src/core/session.ts', readCount: 6, fileName: 'session.ts' }
        ]
      });

      const suggestions = generator.generate(insights);

      const contextAgent = suggestions.find(s => s.name === 'context-keeper');
      expect(contextAgent).toBeDefined();
      expect(contextAgent?.reason).toContain('session.ts read 6x');
    });

    it('generates language specialist for known project types', () => {
      const insights = createMockInsights({
        projectType: 'go',
        fileTypes: [{ ext: '.go', editCount: 20, readCount: 10 }]
      });

      const suggestions = generator.generate(insights);

      const langAgent = suggestions.find(s => s.name === 'go-specialist');
      expect(langAgent).toBeDefined();
      expect(langAgent?.markdown).toContain('go build');
      expect(langAgent?.markdown).toContain('go test');
    });

    it('skips language specialist for unknown project type', () => {
      const insights = createMockInsights({
        projectType: 'unknown'
      });

      const suggestions = generator.generate(insights);
      const langAgent = suggestions.find(s => s.name.includes('-specialist'));

      expect(langAgent).toBeUndefined();
    });

    it('generates quality guard when failed checks exist', () => {
      const insights = createMockInsights({
        failedChecks: [
          { name: 'lint', count: 2, regressions: 0, lastOutput: 'lint error' }
        ],
        qualityHotspots: [
          { target: '/project/src', count: 2, checks: ['lint'] }
        ]
      });

      const suggestions = generator.generate(insights);
      const qualityAgent = suggestions.find(s => s.name === 'quality-guard');

      expect(qualityAgent).toBeDefined();
      expect(qualityAgent?.reason).toContain('lint');
    });

    it('generates regression fixer when regressions are present', () => {
      const insights = createMockInsights({
        failedChecks: [
          { name: 'typecheck', count: 1, regressions: 1, lastOutput: 'type error' }
        ]
      });

      const suggestions = generator.generate(insights);
      const regressionAgent = suggestions.find(s => s.name === 'regression-fixer');

      expect(regressionAgent).toBeDefined();
      expect(regressionAgent?.reason).toContain('regressions');
    });

    it('appends user context to all agents when provided', () => {
      const insights = createMockInsights({
        hotFolders: [{ path: '/project/src/api', editCount: 10, readCount: 5 }]
      });
      const userContext = 'Focus on REST API endpoints';

      const suggestions = generator.generate(insights, userContext);

      expect(suggestions.length).toBeGreaterThan(0);
      for (const suggestion of suggestions) {
        expect(suggestion.markdown).toContain('Additional Context');
        expect(suggestion.markdown).toContain('Focus on REST API endpoints');
      }
    });

    it('generates valid markdown frontmatter', () => {
      const insights = createMockInsights({
        hotFolders: [{ path: '/project/src/core', editCount: 15, readCount: 10 }]
      });

      const suggestions = generator.generate(insights);
      const agent = suggestions[0];

      expect(agent.markdown).toMatch(/^---\nname: /);
      expect(agent.markdown).toContain('description:');
      expect(agent.markdown).toContain('tools:');
      expect(agent.markdown).toMatch(/---\n\n#/);
    });
  });
});

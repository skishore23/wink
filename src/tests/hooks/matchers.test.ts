/**
 * Hook matcher tests
 *
 * Ensures each tool matches exactly ONE PostToolUse hook
 * to prevent duplicate execution
 */

import { describe, it, expect } from 'vitest';

// Define matchers from hooks.json
const postToolUseMatchers = [
  { name: 'postEdit', pattern: /^(Write|Edit|MultiEdit)$/ },
  { name: 'postRead', pattern: /^(Read|View|Grep|Glob)$/ },
  { name: 'postToolUse', pattern: /^(Bash|Task|WebFetch|WebSearch|Skill|TodoWrite|AskUserQuestion|EnterPlanMode|ExitPlanMode|NotebookEdit|KillShell|TaskOutput)$/ },
];

const preToolUseMatchers = [
  { name: 'preToolUse-edit', pattern: /^(Write|Edit|MultiEdit)$/ },
  { name: 'preToolUse-read', pattern: /^(Read|View)$/ },
  { name: 'preToolUse-search', pattern: /^(Grep|Glob)$/ },
  { name: 'preToolUse-task', pattern: /^Task$/ },
];

function getMatchingHooks(toolName: string, matchers: typeof postToolUseMatchers): string[] {
  return matchers
    .filter(m => m.pattern.test(toolName))
    .map(m => m.name);
}

describe('PostToolUse Hook Matchers', () => {
  // All tools that should be handled by PostToolUse hooks
  const allTools = [
    // Edit tools -> postEdit
    'Write', 'Edit', 'MultiEdit',
    // Read tools -> postRead
    'Read', 'View', 'Grep', 'Glob',
    // Other tools -> postToolUse
    'Bash', 'Task', 'WebFetch', 'WebSearch', 'Skill', 'TodoWrite',
    'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'NotebookEdit',
    'KillShell', 'TaskOutput'
  ];

  it('each tool matches exactly one PostToolUse hook', () => {
    for (const tool of allTools) {
      const matches = getMatchingHooks(tool, postToolUseMatchers);
      expect(matches, `Tool "${tool}" should match exactly one hook, but matched: ${JSON.stringify(matches)}`).toHaveLength(1);
    }
  });

  it('edit tools match postEdit only', () => {
    expect(getMatchingHooks('Write', postToolUseMatchers)).toEqual(['postEdit']);
    expect(getMatchingHooks('Edit', postToolUseMatchers)).toEqual(['postEdit']);
    expect(getMatchingHooks('MultiEdit', postToolUseMatchers)).toEqual(['postEdit']);
  });

  it('read tools match postRead only', () => {
    expect(getMatchingHooks('Read', postToolUseMatchers)).toEqual(['postRead']);
    expect(getMatchingHooks('View', postToolUseMatchers)).toEqual(['postRead']);
    expect(getMatchingHooks('Grep', postToolUseMatchers)).toEqual(['postRead']);
    expect(getMatchingHooks('Glob', postToolUseMatchers)).toEqual(['postRead']);
  });

  it('bash and task tools match postToolUse only', () => {
    expect(getMatchingHooks('Bash', postToolUseMatchers)).toEqual(['postToolUse']);
    expect(getMatchingHooks('Task', postToolUseMatchers)).toEqual(['postToolUse']);
  });

  it('web tools match postToolUse only', () => {
    expect(getMatchingHooks('WebFetch', postToolUseMatchers)).toEqual(['postToolUse']);
    expect(getMatchingHooks('WebSearch', postToolUseMatchers)).toEqual(['postToolUse']);
  });

  it('interaction tools match postToolUse only', () => {
    expect(getMatchingHooks('Skill', postToolUseMatchers)).toEqual(['postToolUse']);
    expect(getMatchingHooks('TodoWrite', postToolUseMatchers)).toEqual(['postToolUse']);
    expect(getMatchingHooks('AskUserQuestion', postToolUseMatchers)).toEqual(['postToolUse']);
  });

  it('plan mode tools match postToolUse only', () => {
    expect(getMatchingHooks('EnterPlanMode', postToolUseMatchers)).toEqual(['postToolUse']);
    expect(getMatchingHooks('ExitPlanMode', postToolUseMatchers)).toEqual(['postToolUse']);
  });

  it('notebook and shell tools match postToolUse only', () => {
    expect(getMatchingHooks('NotebookEdit', postToolUseMatchers)).toEqual(['postToolUse']);
    expect(getMatchingHooks('KillShell', postToolUseMatchers)).toEqual(['postToolUse']);
    expect(getMatchingHooks('TaskOutput', postToolUseMatchers)).toEqual(['postToolUse']);
  });

  it('unknown tools do not match any PostToolUse hook', () => {
    // These tools might be added in the future - they should NOT match
    expect(getMatchingHooks('UnknownTool', postToolUseMatchers)).toEqual([]);
    expect(getMatchingHooks('FutureTool', postToolUseMatchers)).toEqual([]);
  });
});

describe('PreToolUse Hook Matchers', () => {
  const preToolUseTools = [
    'Write', 'Edit', 'MultiEdit',
    'Read', 'View',
    'Grep', 'Glob',
    'Task'
  ];

  it('each handled tool matches exactly one PreToolUse hook', () => {
    for (const tool of preToolUseTools) {
      const matches = getMatchingHooks(tool, preToolUseMatchers);
      expect(matches, `Tool "${tool}" should match exactly one PreToolUse hook`).toHaveLength(1);
    }
  });

  it('edit tools match preToolUse-edit', () => {
    expect(getMatchingHooks('Write', preToolUseMatchers)).toEqual(['preToolUse-edit']);
    expect(getMatchingHooks('Edit', preToolUseMatchers)).toEqual(['preToolUse-edit']);
    expect(getMatchingHooks('MultiEdit', preToolUseMatchers)).toEqual(['preToolUse-edit']);
  });

  it('read tools match preToolUse-read', () => {
    expect(getMatchingHooks('Read', preToolUseMatchers)).toEqual(['preToolUse-read']);
    expect(getMatchingHooks('View', preToolUseMatchers)).toEqual(['preToolUse-read']);
  });

  it('search tools match preToolUse-search', () => {
    expect(getMatchingHooks('Grep', preToolUseMatchers)).toEqual(['preToolUse-search']);
    expect(getMatchingHooks('Glob', preToolUseMatchers)).toEqual(['preToolUse-search']);
  });

  it('task tool matches preToolUse-task', () => {
    expect(getMatchingHooks('Task', preToolUseMatchers)).toEqual(['preToolUse-task']);
  });

  it('unhandled tools do not match PreToolUse hooks', () => {
    // These tools don't need PreToolUse checks
    expect(getMatchingHooks('Bash', preToolUseMatchers)).toEqual([]);
    expect(getMatchingHooks('WebFetch', preToolUseMatchers)).toEqual([]);
  });
});

describe('No Overlap Between Matchers', () => {
  it('postEdit and postRead do not overlap', () => {
    const postEditPattern = /^(Write|Edit|MultiEdit)$/;
    const postReadPattern = /^(Read|View|Grep|Glob)$/;

    const allTools = ['Write', 'Edit', 'MultiEdit', 'Read', 'View', 'Grep', 'Glob'];
    for (const tool of allTools) {
      const matchesEdit = postEditPattern.test(tool);
      const matchesRead = postReadPattern.test(tool);
      expect(matchesEdit && matchesRead, `Tool "${tool}" should not match both postEdit and postRead`).toBe(false);
    }
  });

  it('postToolUse does not overlap with postEdit or postRead', () => {
    const postEditPattern = /^(Write|Edit|MultiEdit)$/;
    const postReadPattern = /^(Read|View|Grep|Glob)$/;
    const postToolUsePattern = /^(Bash|Task|WebFetch|WebSearch|Skill|TodoWrite|AskUserQuestion|EnterPlanMode|ExitPlanMode|NotebookEdit|KillShell|TaskOutput)$/;

    const editTools = ['Write', 'Edit', 'MultiEdit'];
    const readTools = ['Read', 'View', 'Grep', 'Glob'];

    for (const tool of editTools) {
      expect(postToolUsePattern.test(tool), `Edit tool "${tool}" should not match postToolUse`).toBe(false);
    }

    for (const tool of readTools) {
      expect(postToolUsePattern.test(tool), `Read tool "${tool}" should not match postToolUse`).toBe(false);
    }
  });
});

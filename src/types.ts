export interface HookInput {
  tool_name: string;
  tool_input: any;
  tool_output?: any;
}

export interface HookOutput {
  decision?: 'allow' | 'block';
  reason?: string;
  additionalContext?: string;
}

// Type alias for semantic clarity
export type PreToolUseInput = HookInput;
export interface PostToolUseInput extends HookInput {
  tool_output: any;
}
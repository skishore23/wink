export interface ToolResponse {
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  type?: string;
  file?: { filePath?: string; content?: string };
  isImage?: boolean;
  error?: string;
}

export interface BaseHookInput {
  session_id?: string;
  hook_event_name?: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id?: string;
}

export interface PreToolUseInput extends BaseHookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface PreToolUseOutput {
  decision: 'approve' | 'block';
  reason?: string;
}

export interface PostToolUseInput extends BaseHookInput {
  session_id: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: ToolResponse | string;
  tool_use_id: string;
}

export interface PostToolUseOutput {
  additionalContext?: string;
}

export interface StopGateInput {
  tool_name: string;
  tool_input: unknown;
}

export interface StopGateOutput {
  decision?: 'approve' | 'block';
  reason?: string;
}

export interface SessionStartInput {
  session_id?: string;
  cwd?: string;
}

export type SessionStartOutput = Record<string, never>;

export interface UserPromptSubmitInput {
  prompt?: string;
  session_id?: string;
}

export interface UserPromptSubmitOutput {
  additionalContext?: string;
}

export interface VerificationResult {
  name: string;
  passed: boolean;
  output?: string;
  error?: string;
  duration_ms?: number;
}

export interface FastVerifyResult {
  checks: VerificationResult[];
  allPassing: boolean;
  duration_ms: number;
}

export type HookDecision = 'approve' | 'block';

export type HookResult =
  | PreToolUseOutput
  | PostToolUseOutput
  | StopGateOutput
  | UserPromptSubmitOutput
  | SessionStartOutput;

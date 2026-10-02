// Types partagés entre le front et le worker (miroir du schéma SQL).

export type MissionStatus =
  | 'queued'
  | 'running'
  | 'cancel_requested'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Mission {
  id: string;
  prompt: string;
  workspace: string;
  parent_id: string | null;
  status: MissionStatus;
  session_id: string | null;
  result: string | null;
  error: string | null;
  files_changed: string[];
  cost_usd: number | null;
  ruflo_agents: RufloAgent[] | null;
  use_worktree: boolean;
  branch: string | null;
  worktree_path: string | null;
  base_commit: string | null;
  worktree_state: 'active' | 'merged' | 'discarded' | null;
  worktree_action: 'merge' | 'discard' | null;
  worktree_error: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** Agent du registre Ruflo, tel que renvoyé par `ruflo agent list --format json`. */
export interface RufloAgent {
  agentId: string;
  agentType: string;
  status: string;
  createdAt?: string;
  lastActivityAt?: string;
}

export interface MissionEvent {
  id: number;
  mission_id: string;
  seq: number;
  type: string;
  payload: StreamEvent;
  created_at: string;
}

export interface Workspace {
  name: string;
  last_seen_at: string;
}

export const FINISHED_STATUSES: readonly MissionStatus[] = ['completed', 'failed', 'cancelled'];

// --- Événements stream-json de Claude Code (sous-ensemble utilisé par MarIA) ---

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | { type: string };

export interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  model?: string;
  tools?: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
  message?: { content?: ContentBlock[] | string };
  // Événement 'result'
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  permission_denials?: Array<{ tool_name: string; tool_input?: Record<string, unknown> }>;
  // Événements system task_* (sous-agents)
  tool_use_id?: string;
  status?: string;
  is_backgrounded?: boolean;
  last_tool_name?: string;
  usage?: { tool_uses?: number };
  // Événement 'maria' (émis par le worker)
  level?: 'info' | 'warn' | 'error';
  text?: string;
}

export interface PermissionRequest {
  id: string;
  mission_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'allowed' | 'denied' | 'expired';
  response: Record<string, string> | null;
  created_at: string;
}

/** Entrée de l'outil AskUserQuestion de Claude Code. */
export interface AgentQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string }>;
}

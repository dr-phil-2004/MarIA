import { describeTool } from './feed';
import type { MissionEvent, ToolResultBlock, ToolUseBlock } from './types';

export type AgentStatus = 'running' | 'done' | 'error' | 'interrupted';

/** Sous-agent Claude Code lancé via l'outil Agent (ou Task, son ancien nom). */
export interface SubAgentRun {
  id: string;
  type: string;
  description: string;
  status: AgentStatus;
  actions: number;
  lastAction: string | null;
  /** Agent qui l'a lancé (null = agent principal). */
  parentId: string | null;
}

export interface AgentsSummary {
  mainActions: number;
  subAgents: SubAgentRun[];
  /** Appels aux outils MCP de Ruflo (swarm_init, agent_spawn…), par nom court. */
  rufloCalls: Record<string, number>;
}

const AGENT_TOOLS = new Set(['Agent', 'Task']);
const RUFLO_PREFIX = 'mcp__claude-flow__';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reconstitue les agents d'une mission à partir des événements stream-json :
 * un appel Agent/Task ouvre un sous-agent, ses messages portent parent_tool_use_id,
 * et le tool_result correspondant le clôt.
 */
export function buildAgents(events: MissionEvent[], missionFinished: boolean): AgentsSummary {
  const runs = new Map<string, SubAgentRun>();
  const rufloCalls: Record<string, number> = {};
  let mainActions = 0;

  for (const { payload: e } of events) {
    const content = Array.isArray(e.message?.content) ? e.message.content : [];
    const owner = e.parent_tool_use_id ? runs.get(e.parent_tool_use_id) : undefined;

    if (e.type === 'assistant') {
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        const tool = block as ToolUseBlock;
        const input = tool.input ?? {};

        if (owner) {
          owner.actions++;
          owner.lastAction = `${tool.name} ${describeTool(tool.name, input)}`.trim();
        } else {
          mainActions++;
        }
        if (tool.name.startsWith(RUFLO_PREFIX)) {
          const short = tool.name.slice(RUFLO_PREFIX.length);
          rufloCalls[short] = (rufloCalls[short] ?? 0) + 1;
        }
        if (AGENT_TOOLS.has(tool.name)) {
          runs.set(tool.id, {
            id: tool.id,
            type: str(input.subagent_type) || 'general-purpose',
            description: str(input.description),
            status: 'running',
            actions: 0,
            lastAction: null,
            parentId: owner?.id ?? null,
          });
        }
      }
    } else if (e.type === 'user') {
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        const res = block as ToolResultBlock;
        const run = runs.get(res.tool_use_id);
        if (run) run.status = res.is_error ? 'error' : 'done';
      }
    }
  }

  const subAgents = [...runs.values()];
  if (missionFinished) {
    for (const run of subAgents) if (run.status === 'running') run.status = 'interrupted';
  }
  return { mainActions, subAgents, rufloCalls };
}

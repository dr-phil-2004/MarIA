import type { MissionEvent, StreamEvent, ToolResultBlock, ToolUseBlock } from './types';

export type FeedItem =
  | { key: string; kind: 'info'; level: 'info' | 'warn' | 'error'; text: string }
  | { key: string; kind: 'text'; agent: string; text: string }
  | { key: string; kind: 'tool'; agent: string; tool: string; detail: string }
  | { key: string; kind: 'tool_result'; agent: string; isError: boolean; text: string }
  | { key: string; kind: 'done'; isError: boolean; text: string };

const MAIN_AGENT = 'MarIA';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Résumé lisible de l'appel d'outil, ex. « npm test » pour Bash ou le chemin pour Edit. */
export function describeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
      return str(input.command);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return str(input.file_path);
    case 'NotebookEdit':
      return str(input.notebook_path);
    case 'Grep':
    case 'Glob':
      return `${str(input.pattern)}${input.path ? ` dans ${str(input.path)}` : ''}`;
    case 'WebFetch':
      return str(input.url);
    case 'WebSearch':
      return str(input.query);
    case 'Task':
    case 'Agent':
      return `${str(input.subagent_type) || 'agent'} : ${str(input.description)}`;
    default:
      return truncate(JSON.stringify(input), 160);
  }
}

function resultText(block: ToolResultBlock): string {
  if (typeof block.content === 'string') return block.content;
  return (block.content ?? []).map((c) => c.text ?? '').join(' ');
}

/**
 * Transforme les événements bruts en lignes de fil d'activité.
 * Les messages émis par un sous-agent portent parent_tool_use_id : on les attribue
 * au subagent_type de l'appel Task/Agent correspondant (« qui fait quoi »).
 */
export function buildFeed(events: MissionEvent[]): FeedItem[] {
  const agentByToolUse = new Map<string, string>();
  const items: FeedItem[] = [];

  for (const { id, payload: e } of events) {
    const agent = (e.parent_tool_use_id && agentByToolUse.get(e.parent_tool_use_id)) || MAIN_AGENT;
    const content = Array.isArray(e.message?.content) ? e.message.content : [];

    switch (e.type) {
      case 'maria':
        items.push({ key: `${id}`, kind: 'info', level: e.level ?? 'info', text: e.text ?? '' });
        break;
      case 'system':
        if (e.subtype === 'init') {
          items.push({
            key: `${id}`,
            kind: 'info',
            level: 'info',
            text: `Session Claude Code ouverte${e.model ? ` — modèle ${e.model}` : ''}${e.tools ? `, ${e.tools.length} outils` : ''}`,
          });
        }
        break;
      case 'assistant':
        content.forEach((block, i) => {
          if (block.type === 'text') {
            const text = (block as { text: string }).text.trim();
            if (text) items.push({ key: `${id}-${i}`, kind: 'text', agent, text });
          } else if (block.type === 'tool_use') {
            const tool = block as ToolUseBlock;
            if ((tool.name === 'Task' || tool.name === 'Agent') && typeof tool.input?.subagent_type === 'string') {
              agentByToolUse.set(tool.id, tool.input.subagent_type);
            }
            items.push({ key: `${id}-${i}`, kind: 'tool', agent, tool: tool.name, detail: describeTool(tool.name, tool.input ?? {}) });
          }
        });
        break;
      case 'user':
        content.forEach((block, i) => {
          if (block.type !== 'tool_result') return;
          const res = block as ToolResultBlock;
          items.push({ key: `${id}-${i}`, kind: 'tool_result', agent, isError: !!res.is_error, text: truncate(resultText(res), 300) });
        });
        break;
      case 'result':
        items.push({ key: `${id}`, kind: 'done', isError: !!e.is_error, text: summarizeResult(e) });
        break;
    }
  }
  return items;
}

function summarizeResult(e: StreamEvent): string {
  const parts: string[] = [];
  if (e.duration_ms != null) parts.push(`${Math.round(e.duration_ms / 1000)} s`);
  if (e.num_turns != null) parts.push(`${e.num_turns} tours`);
  if (e.total_cost_usd != null) parts.push(`$${e.total_cost_usd.toFixed(4)}`);
  return `${e.is_error ? 'Échec' : 'Terminé'}${parts.length ? ` — ${parts.join(' · ')}` : ''}`;
}

// Connecteurs activés dans MarIA → serveurs MCP et outils pré-autorisés pour une mission.
import { CATALOG, expandArgs, expandVars, resolveDef, type ConnectorConfig, type ConnectorDef } from '../src/lib/connectors';
import type { Store } from './store';

export type McpServer =
  | { command: string; args: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> };

export interface ConnectorPlan {
  servers: Record<string, McpServer>;
  /** Règles --allowedTools : mcp__<id> (tout le serveur) ou mcp__<id>__<outil>, plus les réglages globaux. */
  allowed: string[];
  loaded: string[];
  notes: string[];
}

/** Noms de toutes les variables d'environnement demandées par les connecteurs (pour l'état du worker). */
export function connectorEnvNames(configs: ConnectorConfig[]): string[] {
  return [...CATALOG.flatMap((c) => [...c.env, ...(c.optionalEnv ?? [])]), ...configs.flatMap((c) => c.custom?.env ?? [])];
}

/** Serveur distant : adresse https (ou http local) et en-têtes non vides, variables remplacées. */
function httpServer(def: ConnectorDef, env: Record<string, string | undefined>): McpServer {
  const url = expandVars(def.url ?? '', env).trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${def.name} : adresse MCP invalide`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw new Error(`${def.name} : l’adresse MCP doit être en https`);
  const headers = Object.fromEntries(
    Object.entries(def.headers ?? {})
      .map(([k, v]) => [k, expandVars(v, env).trim()] as const)
      // « Bearer » seul : la variable est absente, on n'envoie pas l'en-tête.
      .filter(([, v]) => v && !/^(Bearer|Token|Basic)$/i.test(v)),
  );
  return { type: 'http', url, ...(Object.keys(headers).length > 0 ? { headers } : {}) };
}

/**
 * Construit les connecteurs d'une mission. Un connecteur réservé à certains agents n'est chargé
 * que si la mission en mentionne au moins un (@agent).
 */
export async function connectorPlan(store: Store, chain: string[]): Promise<ConnectorPlan> {
  const plan: ConnectorPlan = { servers: {}, allowed: [], loaded: [], notes: [] };
  const [configs, globalAllowed] = await Promise.all([store.listConnectors(), store.getSetting<string[]>('allowed_tools')]);
  if (Array.isArray(globalAllowed)) plan.allowed.push(...globalAllowed.filter((t) => typeof t === 'string' && t.trim()));

  for (const config of configs) {
    if (!config.enabled) continue;
    const def = resolveDef(config);
    if (!def) continue;
    if (config.agents && config.agents.length > 0 && !config.agents.some((a) => chain.includes(a))) continue;
    const missing = def.env.filter((v) => !process.env[v]?.trim());
    if (missing.length > 0) {
      plan.notes.push(`${def.name} activé mais ${missing.join(', ')} absent de .env.local du worker : connecteur ignoré.`);
      continue;
    }
    if (def.transport === 'http') {
      try {
        plan.servers[config.id] = httpServer(def, process.env);
      } catch (err) {
        plan.notes.push(`${(err as Error).message} : connecteur ignoré.`);
        continue;
      }
    } else {
      const names = [...def.env, ...(def.optionalEnv ?? []).filter((v) => process.env[v]?.trim())];
      const env = Object.fromEntries(names.map((v) => [v, process.env[v] as string]));
      plan.servers[config.id] = { command: def.command, args: expandArgs(def.args, process.env), ...(names.length ? { env } : {}) };
    }
    plan.loaded.push(def.name);
    if (config.policy === 'allow') plan.allowed.push(`mcp__${config.id}`);
    else plan.allowed.push(...config.allowed_tools.filter(Boolean).map((t) => `mcp__${config.id}__${t}`));
  }
  return plan;
}

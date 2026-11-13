// Fournisseur de modèle d'une mission : choix explicite (mission ou routine), sinon préférence du premier agent
// de la chaîne, sinon réglage global, sinon Claude avec MARIA_MODEL.
import { SETTING_AGENT_MODELS, SETTING_DEFAULT_MODEL, describeChoice, isModelChoice, type ModelChoice } from '../src/lib/providers';
import type { Mission } from '../src/lib/types';
import type { WorkerConfig } from './config';
import type { Store } from './store';

export interface ResolvedModel {
  choice: ModelChoice;
  /** D'où vient le choix, pour le fil de la mission. */
  source: string;
  /** Variables d'environnement ajoutées au processus Claude Code. */
  env: Record<string, string>;
  /** Valeur de --model (null = celui de Claude Code). */
  modelArg: string | null;
}

export async function resolveModel(store: Store, cfg: WorkerConfig, mission: Mission, chain: string[]): Promise<ResolvedModel> {
  let choice: ModelChoice | null = null;
  let source = 'réglage par défaut';
  if (mission.provider) {
    choice = { provider: mission.provider, model: mission.model ?? null };
    source = mission.routine_id ? 'routine' : 'mission';
  }
  if (!choice && chain.length > 0) {
    const perAgent = await store.getSetting<Record<string, unknown>>(SETTING_AGENT_MODELS).catch(() => null);
    const pref = perAgent?.[chain[0]];
    if (isModelChoice(pref)) {
      choice = pref;
      source = `agent @${chain[0]}`;
    }
  }
  if (!choice) {
    const global = await store.getSetting<unknown>(SETTING_DEFAULT_MODEL).catch(() => null);
    if (isModelChoice(global)) choice = global;
  }
  if (!choice) choice = { provider: 'claude', model: cfg.model };

  if (choice.provider === 'claude') {
    return { choice, source, env: {}, modelArg: choice.model ?? cfg.model };
  }
  if (!choice.model) throw new Error('OpenRouter choisi sans identifiant de modèle (ex. qwen/qwen3-coder:free).');
  if (!cfg.openrouterKey) {
    throw new Error('OpenRouter choisi, mais OPENROUTER_API_KEY est absente de .env.local du worker (puis npm run service -- restart).');
  }
  const m = choice.model;
  return {
    choice,
    source,
    modelArg: m,
    // API compatible Anthropic d'OpenRouter ; tous les alias (et les sous-agents) pointent vers le même modèle,
    // sinon Claude Code demanderait un modèle Claude payant à OpenRouter.
    env: {
      ANTHROPIC_BASE_URL: cfg.openrouterBaseUrl,
      ANTHROPIC_AUTH_TOKEN: cfg.openrouterKey,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: m,
      ANTHROPIC_DEFAULT_OPUS_MODEL: m,
      ANTHROPIC_DEFAULT_SONNET_MODEL: m,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: m,
      ANTHROPIC_SMALL_FAST_MODEL: m,
      CLAUDE_CODE_SUBAGENT_MODEL: m,
    },
  };
}

export function describeResolved(r: ResolvedModel): string {
  return `${describeChoice(r.choice)}${r.choice.provider === 'claude' && !r.modelArg ? ' (modèle par défaut de Claude Code)' : ''} — ${r.source}`;
}

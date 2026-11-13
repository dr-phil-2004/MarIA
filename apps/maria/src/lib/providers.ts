// Fournisseurs de modèle des missions : Claude (le compte Claude Code du worker) ou OpenRouter
// (API compatible Anthropic, dont des modèles gratuits « :free »). La clé OpenRouter reste dans .env.local du worker.

export type ProviderId = 'claude' | 'openrouter';

export interface ModelChoice {
  provider: ProviderId;
  /** Claude : alias (sonnet, opus, haiku) ou null = modèle par défaut ; OpenRouter : identifiant obligatoire. */
  model: string | null;
}

export const PROVIDERS: Array<{ id: ProviderId; name: string; description: string; env: string | null }> = [
  { id: 'claude', name: 'Claude', description: 'Ton compte Claude Code sur la machine du worker (abonnement ou clé API).', env: null },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Des centaines de modèles, dont des gratuits (« :free »). Moins fiables pour les outils : à réserver aux tâches légères.',
    env: 'OPENROUTER_API_KEY',
  },
];

/** Exemples d'identifiants ; la liste à jour est sur openrouter.ai/models (filtre « free »). */
export const OPENROUTER_EXAMPLES = ['qwen/qwen3-coder:free', 'deepseek/deepseek-chat-v3.1:free', 'z-ai/glm-4.5-air:free', 'moonshotai/kimi-k2:free'];

export const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku'];

/** Clés de maria.settings. */
export const SETTING_DEFAULT_MODEL = 'model_provider';
export const SETTING_AGENT_MODELS = 'agent_providers';

export function isValidModelId(model: string): boolean {
  return /^[A-Za-z0-9][\w.:/-]{0,119}$/.test(model);
}

export function isModelChoice(value: unknown): value is ModelChoice {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ModelChoice>;
  if (v.provider !== 'claude' && v.provider !== 'openrouter') return false;
  if (v.model == null) return v.provider === 'claude';
  return typeof v.model === 'string' && isValidModelId(v.model);
}

export function describeChoice(choice: ModelChoice | null | undefined): string {
  if (!choice) return 'Par défaut';
  if (choice.provider === 'openrouter') return `OpenRouter · ${choice.model ?? '?'}`;
  return choice.model ? `Claude · ${choice.model}` : 'Claude';
}

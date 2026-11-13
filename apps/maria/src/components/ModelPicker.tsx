'use client';

import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import {
  CLAUDE_MODELS,
  OPENROUTER_EXAMPLES,
  SETTING_DEFAULT_MODEL,
  isModelChoice,
  isValidModelId,
  type ModelChoice,
  type ProviderId,
} from '@/lib/providers';

interface PickerProps {
  value: ModelChoice | null;
  onChange: (value: ModelChoice | null) => void;
  /** Propose « Par défaut » (null) : routine, agent. */
  allowDefault?: boolean;
  defaultLabel?: string;
}

/** Choix du fournisseur (Claude / OpenRouter) et du modèle. */
export function ModelPicker({ value, onChange, allowDefault = false, defaultLabel = 'Par défaut' }: PickerProps) {
  const [draft, setDraft] = useState(value?.model ?? '');
  useEffect(() => setDraft(value?.model ?? ''), [value?.provider, value?.model]);

  const provider: ProviderId | null = value?.provider ?? null;
  const pick = (p: ProviderId | null) =>
    onChange(p === null ? null : p === 'claude' ? { provider: 'claude', model: null } : { provider: 'openrouter', model: value?.provider === 'openrouter' ? value.model : OPENROUTER_EXAMPLES[0] });
  const invalid = provider === 'openrouter' && !isValidModelId(draft.trim());

  return (
    <div className="mp">
      <div className="as-seg">
        {allowDefault && (
          <button type="button" className={provider === null ? 'active' : ''} onClick={() => pick(null)}>
            {defaultLabel}
          </button>
        )}
        <button type="button" className={provider === 'claude' ? 'active' : ''} onClick={() => pick('claude')}>
          Claude
        </button>
        <button type="button" className={provider === 'openrouter' ? 'active' : ''} onClick={() => pick('openrouter')}>
          OpenRouter
        </button>
      </div>
      {provider === 'claude' && (
        <select value={value?.model ?? ''} onChange={(e) => onChange({ provider: 'claude', model: e.target.value || null })}>
          <option value="">Modèle par défaut de Claude Code</option>
          {CLAUDE_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
      {provider === 'openrouter' && (
        <>
          <input
            className="mono"
            list="openrouter-models"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => isValidModelId(draft.trim()) && draft.trim() !== value?.model && onChange({ provider: 'openrouter', model: draft.trim() })}
            placeholder="qwen/qwen3-coder:free"
            aria-invalid={invalid}
          />
          <datalist id="openrouter-models">
            {OPENROUTER_EXAMPLES.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <span className={`small ${invalid ? 'error' : 'muted'}`}>
            {invalid ? 'Identifiant invalide.' : 'Identifiant OpenRouter (les gratuits finissent par :free ; liste sur openrouter.ai/models).'}
          </span>
        </>
      )}
    </div>
  );
}

/** Carte de la page Connecteurs : fournisseur utilisé quand ni la mission, ni la routine, ni l'agent n'en fixent un. */
export function DefaultModelCard({ keyPresent }: { keyPresent: boolean | null }) {
  const [value, setValue] = useState<ModelChoice | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSupabase()
      .from('settings')
      .select('value')
      .eq('key', SETTING_DEFAULT_MODEL)
      .maybeSingle()
      .then(({ data }) => setValue(isModelChoice(data?.value) ? data.value : { provider: 'claude', model: null }));
  }, []);

  async function save(next: ModelChoice | null) {
    if (!next) return;
    setValue(next);
    setSaved(false);
    const { error: err } = await getSupabase().from('settings').upsert({ key: SETTING_DEFAULT_MODEL, value: next });
    if (err) setError(/settings/.test(err.message) ? 'Applique la migration 0011_connectors.sql pour enregistrer ce réglage.' : err.message);
    else {
      setError(null);
      setSaved(true);
    }
  }

  return (
    <div className="float-card cx-allowed">
      <div className="cx-stat-head">
        <Cpu size={16} strokeWidth={2} />
        <span>Modèle par défaut des missions</span>
      </div>
      <p className="muted small">
        Utilisé quand ni la mission, ni la routine, ni le premier agent mentionné (réglage dans l’atelier) n’en choisissent un. Claude reste le plus fiable pour modifier du code ; OpenRouter
        gratuit convient aux tâches légères (résumés, tri, rapports).
      </p>
      {value && <ModelPicker value={value} onChange={(v) => void save(v)} />}
      {value?.provider === 'openrouter' && keyPresent === false && (
        <p className="as-offline small">
          <code>OPENROUTER_API_KEY</code> est absente du .env.local du worker : les missions OpenRouter échoueront.
        </p>
      )}
      {error && <p className="error small">{error}</p>}
      {saved && <span className="as-ok small">Enregistré.</span>}
    </div>
  );
}

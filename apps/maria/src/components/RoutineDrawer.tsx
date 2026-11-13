'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, KeyRound, RefreshCw, Trash2, X } from 'lucide-react';
import { WEEKDAYS_FR, cronToPreset, isValidCron, isValidTimezone, nextRun, presetToCron, type SchedulePreset } from '@/lib/cron';
import { getSupabase } from '@/lib/supabase';
import type { Routine, Workspace } from '@/lib/types';
import { AgentPrompt } from './AgentPrompt';

const BROWSER_TZ = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

async function newToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { token, hash };
}

export function fmtRun(date: Date, timezone: string): string {
  return date.toLocaleString('fr-FR', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ghost-btn cx-copy"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
      {done ? 'Copié' : 'Copier'}
    </button>
  );
}

interface Props {
  routine: Routine | null;
  workspaces: Workspace[];
  onClose: () => void;
  onSaved: (routine: Routine) => void;
  onDeleted: (id: string) => void;
}

/** Création et réglages d'une routine : consigne, déclencheur (planning ou webhook) et options. */
export function RoutineDrawer({ routine, workspaces, onClose, onSaved, onDeleted }: Props) {
  const [name, setName] = useState(routine?.name ?? '');
  const [workspace, setWorkspace] = useState(routine?.workspace ?? workspaces[0]?.name ?? '');
  const [prompt, setPrompt] = useState(routine?.prompt ?? '');
  const [trigger, setTrigger] = useState<Routine['trigger']>(routine?.trigger ?? 'schedule');
  const [preset, setPreset] = useState<SchedulePreset>(routine?.cron ? cronToPreset(routine.cron) : { kind: 'weekdays', hour: 9, minute: 0 });
  const [timezone, setTimezone] = useState(routine?.timezone ?? BROWSER_TZ);
  const [useWorktree, setUseWorktree] = useState(routine?.use_worktree ?? true);
  const [skipIfRunning, setSkipIfRunning] = useState(routine?.skip_if_running ?? true);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cron = presetToCron(preset);
  const tzOk = isValidTimezone(timezone);
  const cronOk = isValidCron(cron);
  const upcoming = useMemo(() => {
    if (trigger !== 'schedule' || !cronOk || !tzOk) return [];
    const out: Date[] = [];
    let from = new Date();
    for (let i = 0; i < 3; i++) {
      const next = nextRun(cron, timezone, from);
      if (!next) break;
      out.push(next);
      from = next;
    }
    return out;
  }, [trigger, cron, cronOk, timezone, tzOk]);

  const agents = workspaces.find((w) => w.name === workspace)?.agents ?? [];
  const valid = name.trim() && workspace && prompt.trim() && (trigger === 'webhook' || (cronOk && tzOk && upcoming.length > 0));
  const endpoint = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://xxxx.supabase.co'}/rest/v1/rpc/fire_routine`;
  const curl = (t: string) =>
    [
      `curl -X POST '${endpoint}' \\`,
      `  -H 'apikey: ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '<clé anon>'}' \\`,
      `  -H 'Content-Profile: maria' -H 'Content-Type: application/json' \\`,
      `  -d '{"p_token": "${t}", "p_input": "contexte facultatif"}'`,
    ].join('\n');

  async function save(regenerate = false) {
    if (!valid) return;
    setBusy(true);
    setError(null);
    let hash = routine?.webhook_token_hash ?? null;
    let fresh: string | null = null;
    if (trigger === 'webhook' && (!hash || regenerate)) {
      const t = await newToken();
      hash = t.hash;
      fresh = t.token;
    }
    const row = {
      name: name.trim(),
      workspace,
      prompt: prompt.trim(),
      trigger,
      cron: trigger === 'schedule' ? cron : null,
      timezone,
      use_worktree: useWorktree,
      skip_if_running: skipIfRunning,
      webhook_token_hash: trigger === 'webhook' ? hash : null,
      next_run_at: trigger === 'schedule' ? (upcoming[0]?.toISOString() ?? null) : null,
    };
    const query = routine ? getSupabase().from('routines').update(row).eq('id', routine.id) : getSupabase().from('routines').insert(row);
    const { data, error: err } = await query.select().single();
    setBusy(false);
    if (err) {
      setError(/routines/.test(err.message) && /exist|find/.test(err.message) ? 'Applique la migration 0013_routines.sql dans Supabase.' : err.message);
      return;
    }
    onSaved(data as Routine);
    // Le jeton n'est montré qu'une fois : on garde le panneau ouvert pour le copier.
    if (fresh) setToken(fresh);
    else onClose();
  }

  async function remove() {
    if (!routine || !window.confirm(`Supprimer la routine « ${routine.name} » ? Les missions déjà lancées restent.`)) return;
    const { error: err } = await getSupabase().from('routines').delete().eq('id', routine.id);
    if (err) setError(err.message);
    else onDeleted(routine.id);
  }

  const time = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const setTime = (value: string) => {
    const [h, m] = value.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    if (preset.kind === 'daily' || preset.kind === 'weekdays' || preset.kind === 'weekly') setPreset({ ...preset, hour: h, minute: m });
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer rt-drawer" role="dialog" aria-modal="true" aria-label="Routine" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <strong className="rt-drawer-title">{routine ? 'Modifier la routine' : 'Nouvelle routine'}</strong>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {token ? (
          <section className="cx-block">
            <h3>
              <KeyRound size={14} strokeWidth={2} /> Jeton du webhook
            </h3>
            <p className="muted small">Copie-le maintenant : il ne sera plus affiché (seule son empreinte est enregistrée). Garde-le secret, il suffit pour lancer la routine.</p>
            <code className="cx-cmd">{token}</code>
            <CopyButton text={token} />
            <p className="muted small">Exemple d’appel (script, GitHub Action, n8n, Zapier…) :</p>
            <pre className="as-file-pre">{curl(token)}</pre>
            <CopyButton text={curl(token)} />
            <div className="drawer-actions">
              <button className="primary-btn small" onClick={onClose}>
                J’ai copié le jeton
              </button>
            </div>
          </section>
        ) : (
          <>
            <div className="as-row">
              <label className="field">
                Nom
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Revue des dépendances" maxLength={80} autoFocus={!routine} />
              </label>
              <label className="field">
                Dossier
                <select value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
                  {workspaces.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field">
              Consigne <span className="muted small">Tape @ pour confier la routine à des agents.</span>
              <AgentPrompt value={prompt} onChange={setPrompt} agents={agents} rows={5} onSubmit={() => void save()} placeholder="@security-reviewer Vérifie les dépendances vulnérables et ouvre un ticket par problème trouvé." />
            </div>

            <div className="field">
              Déclencheur
              <div className="as-seg">
                <button type="button" className={trigger === 'schedule' ? 'active' : ''} onClick={() => setTrigger('schedule')}>
                  Planning
                </button>
                <button type="button" className={trigger === 'webhook' ? 'active' : ''} onClick={() => setTrigger('webhook')}>
                  Webhook
                </button>
              </div>
            </div>

            {trigger === 'schedule' ? (
              <section className="cx-block">
                <div className="as-row">
                  <label className="field">
                    Fréquence
                    <select
                      value={preset.kind}
                      onChange={(e) => {
                        const kind = e.target.value as SchedulePreset['kind'];
                        const h = 'hour' in preset ? preset.hour : 9;
                        const m = 'minute' in preset ? preset.minute : 0;
                        setPreset(
                          kind === 'hourly'
                            ? { kind, minute: 0 }
                            : kind === 'weekly'
                              ? { kind, weekday: 1, hour: h, minute: m }
                              : kind === 'custom'
                                ? { kind, cron }
                                : { kind, hour: h, minute: m },
                        );
                      }}
                    >
                      <option value="hourly">Toutes les heures</option>
                      <option value="daily">Chaque jour</option>
                      <option value="weekdays">Du lundi au vendredi</option>
                      <option value="weekly">Chaque semaine</option>
                      <option value="custom">Personnalisé (cron)</option>
                    </select>
                  </label>
                  {preset.kind === 'hourly' && (
                    <label className="field">
                      À la minute
                      <input type="number" min={0} max={59} value={preset.minute} onChange={(e) => setPreset({ kind: 'hourly', minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })} />
                    </label>
                  )}
                  {(preset.kind === 'daily' || preset.kind === 'weekdays' || preset.kind === 'weekly') && (
                    <label className="field">
                      Heure
                      <input type="time" value={time(preset.hour, preset.minute)} onChange={(e) => setTime(e.target.value)} />
                    </label>
                  )}
                  {preset.kind === 'custom' && (
                    <label className="field">
                      Expression cron {!cronOk && <span className="error small">(invalide)</span>}
                      <input value={preset.cron} onChange={(e) => setPreset({ kind: 'custom', cron: e.target.value })} placeholder="0 9 * * 1" className="mono" />
                    </label>
                  )}
                </div>
                {preset.kind === 'weekly' && (
                  <div className="chips">
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <button key={d} type="button" className={`chip ${preset.weekday === d ? 'active' : ''}`} onClick={() => setPreset({ ...preset, weekday: d })}>
                        {WEEKDAYS_FR[d]}
                      </button>
                    ))}
                  </div>
                )}
                <label className="field">
                  Fuseau horaire {!tzOk && <span className="error small">(inconnu)</span>}
                  <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Paris" />
                </label>
                {upcoming.length > 0 && (
                  <div className="rt-upcoming">
                    <span className="muted small">Prochaines exécutions</span>
                    {upcoming.map((d) => (
                      <span key={d.toISOString()} className="cx-tag">
                        {fmtRun(d, timezone)}
                      </span>
                    ))}
                  </div>
                )}
                <p className="muted small">La routine tourne quand le worker est en ligne. Une échéance manquée (PC éteint) est rattrapée une seule fois à son retour.</p>
              </section>
            ) : (
              <section className="cx-block">
                <p className="muted small">
                  Une adresse et un jeton secret lancent la routine à chaque appel : GitHub Action, n8n, Zapier, script… Le texte envoyé dans <code>p_input</code> est ajouté à la consigne. Ne
                  branche que des sources de confiance.
                </p>
                {routine?.webhook_token_hash ? (
                  <button type="button" className="ghost-btn rt-regen" onClick={() => window.confirm('L’ancien jeton cessera de fonctionner. Continuer ?') && void save(true)} disabled={!valid || busy}>
                    <RefreshCw size={14} strokeWidth={2} /> Régénérer le jeton
                  </button>
                ) : (
                  <p className="muted small">Le jeton sera créé et affiché une seule fois à l’enregistrement.</p>
                )}
              </section>
            )}

            <label className="rt-check">
              <input type="checkbox" checked={useWorktree} onChange={(e) => setUseWorktree(e.target.checked)} />
              Branche isolée <span className="muted small">(la mission travaille sur sa propre branche, à fusionner ensuite)</span>
            </label>
            <label className="rt-check">
              <input type="checkbox" checked={skipIfRunning} onChange={(e) => setSkipIfRunning(e.target.checked)} />
              Ne pas relancer si l’exécution précédente tourne encore
            </label>

            {error && <p className="error small">{error}</p>}

            <div className="drawer-actions">
              <button className="primary-btn small" onClick={() => void save()} disabled={!valid || busy}>
                {busy ? 'Enregistrement…' : routine ? 'Enregistrer' : 'Créer la routine'}
              </button>
              <button className="ghost-btn" onClick={onClose}>
                Annuler
              </button>
              {routine && (
                <button className="ghost-btn danger-text drawer-dates" onClick={() => void remove()} title="Supprimer">
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

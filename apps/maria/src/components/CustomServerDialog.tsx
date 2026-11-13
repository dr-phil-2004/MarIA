'use client';

import { useState, type FormEvent } from 'react';
import { referencedVars, type ConnectorConfig } from '@/lib/connectors';

function splitList(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((t) => t.trim()).filter(Boolean))];
}

const VAR = /\$\{[A-Z0-9_]+\}/;

interface Props {
  taken: string[];
  onClose: () => void;
  onCreate: (config: ConnectorConfig) => void;
}

/** Déclare un serveur MCP : programme local (commande) ou serveur distant (adresse + en-tête d'authentification). */
export function CustomServerDialog({ taken, onClose, onCreate }: Props) {
  const [kind, setKind] = useState<'stdio' | 'http'>('stdio');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('npx');
  const [args, setArgs] = useState('');
  const [env, setEnv] = useState('');
  const [url, setUrl] = useState('');
  const [headerName, setHeaderName] = useState('Authorization');
  const [headerValue, setHeaderValue] = useState('');

  const idError = !id ? null : !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || id === 'maria' ? 'minuscules, chiffres et tirets' : taken.includes(id) ? 'déjà utilisé' : null;
  const envList = splitList(env).map((v) => v.toUpperCase());
  const envError = envList.some((v) => !/^[A-Z_][A-Z0-9_]*$/.test(v)) ? 'Noms de variables : lettres, chiffres et _' : null;

  // Serveur distant : l'adresse peut contenir ${VAR} ; l'en-tête doit citer une variable, jamais le secret lui-même.
  const urlError = !url ? null : /^(https:\/\/|\$\{)/.test(url.trim()) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(url.trim()) ? null : 'https:// attendu';
  const headerError = headerValue.trim() && !VAR.test(headerValue) ? 'utilise ${VARIABLE} : le secret va dans .env.local' : null;
  const headerNameError = headerValue.trim() && !/^[A-Za-z0-9-]{1,60}$/.test(headerName.trim()) ? 'nom d’en-tête invalide' : null;
  const httpVars = referencedVars([url, headerValue]);

  const valid = kind === 'stdio' ? !!command.trim() && !envError : !!url.trim() && !urlError && !headerError && !headerNameError;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!id || idError || !valid) return;
    const base = { name: name.trim() || id, description: '' };
    onCreate({
      id,
      enabled: true,
      policy: 'ask',
      allowed_tools: [],
      agents: null,
      custom:
        kind === 'stdio'
          ? { ...base, command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : [], env: envList }
          : {
              ...base,
              command: '',
              args: [],
              url: url.trim(),
              headers: headerValue.trim() ? { [headerName.trim()]: headerValue.trim() } : {},
              env: httpVars,
            },
    });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="mcp-dialog" onClick={onClose}>
      <form className="card modal team-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="mcp-dialog">Serveur MCP personnalisé</h2>
        <div className="as-seg">
          <button type="button" className={kind === 'stdio' ? 'active' : ''} onClick={() => setKind('stdio')}>
            Programme local
          </button>
          <button type="button" className={kind === 'http' ? 'active' : ''} onClick={() => setKind('http')}>
            Serveur distant (URL)
          </button>
        </div>
        <div className="tk-dialog-grid">
          <label className="field">
            Identifiant {idError && <span className="error small">({idError})</span>}
            <input autoFocus value={id} onChange={(e) => setId(e.target.value.toLowerCase())} placeholder={kind === 'http' ? 'linear' : 'sentry'} maxLength={40} />
          </label>
          <label className="field">
            Nom affiché
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'http' ? 'Linear' : 'Sentry'} maxLength={60} />
          </label>
        </div>

        {kind === 'stdio' ? (
          <>
            <label className="field">
              Commande
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
            </label>
            <label className="field">
              Arguments (séparés par des espaces ; ${'{'}VAR{'}'} = variable du worker)
              <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @sentry/mcp-server" />
            </label>
            <label className="field">
              Variables d’environnement requises {envError && <span className="error small">({envError})</span>}
              <input value={env} onChange={(e) => setEnv(e.target.value)} placeholder="SENTRY_ACCESS_TOKEN" />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              Adresse MCP {urlError && <span className="error small">({urlError})</span>}
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.exemple.com/mcp  ou  ${MON_URL_MCP}" className="mono" />
            </label>
            <div className="tk-dialog-grid">
              <label className="field">
                En-tête {headerNameError && <span className="error small">({headerNameError})</span>}
                <input value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="Authorization" />
              </label>
              <label className="field">
                Valeur {headerError && <span className="error small">({headerError})</span>}
                <input value={headerValue} onChange={(e) => setHeaderValue(e.target.value)} placeholder="Bearer ${MON_JETON}" className="mono" />
              </label>
            </div>
            {httpVars.length > 0 && (
              <p className="muted small">
                À mettre dans le .env.local du worker : {httpVars.map((v) => <code key={v}>{v}=</code>)}
              </p>
            )}
          </>
        )}
        <p className="muted small">Seuls les noms des variables sont enregistrés ; leurs valeurs restent dans le .env.local du worker.</p>
        <div className="row modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Annuler
          </button>
          <button className="primary-btn small" disabled={!id || !!idError || !valid}>
            Ajouter
          </button>
        </div>
      </form>
    </div>
  );
}

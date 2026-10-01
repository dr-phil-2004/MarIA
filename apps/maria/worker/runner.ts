import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import type { Mission, MissionStatus, StreamEvent, ToolUseBlock } from '../src/lib/types';
import type { WorkerConfig } from './config';
import { diffSnapshots, fileFromToolUse, snapshotDirty } from './files';
import { PERMISSION_TOOL, SERVER_NAME } from './permission-mcp';
import { EventSink, type Store } from './store';

const STATUS_POLL_MS = 2000;
const KILL_GRACE_MS = 5000;
const STDERR_TAIL = 4000;

/** Contexte ajouté au prompt système : l'agent tourne sans terminal, piloté depuis MarIA. */
function headlessNote(cwd: string, interactive: boolean): string {
  return [
    interactive
      ? 'Tu es exécuté par MarIA sans terminal : toute action non pré-autorisée est soumise à l’utilisateur dans l’interface, qui peut l’autoriser ou la refuser.'
      : 'Tu es exécuté en mode headless par MarIA : aucun humain ne peut approuver une permission pendant la mission.',
    `Ton dossier de travail est ${cwd} ; lance les commandes directement depuis ce dossier, sans \`cd\`, et une commande à la fois (pas de && ni de |) pour qu'elles correspondent aux outils pré-autorisés.`,
    'Écris les commandes sous leur forme la plus simple, sans option de changement de dossier (pas de `git -C`, `npm --prefix`, chemins absolus vers le dossier de travail) : par exemple `git status`, `npm test`.',
    "Si une commande est refusée, ne réessaie pas de variantes : continue avec ce que tu peux faire et liste en fin de réponse les commandes à autoriser.",
    "Si tu as besoin d'une décision de l'utilisateur, termine ta réponse par une question claire : il pourra répondre via « Continuer ».",
  ].join('\n');
}

/** Déclare le serveur MCP de permissions (worker/permission-mcp.ts), lancé par Claude Code. */
function permissionMcpConfig(cfg: WorkerConfig, missionId: string): string {
  return JSON.stringify({
    mcpServers: {
      [SERVER_NAME]: {
        command: process.execPath,
        args: [path.join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(__dirname, 'permission-mcp.ts')],
        env: { MARIA_MISSION_ID: missionId, MARIA_PERMISSION_TIMEOUT_MS: String(cfg.permissionTimeoutMs) },
      },
    },
  });
}

function buildArgs(cfg: WorkerConfig, cwd: string, missionId: string, resumeSessionId: string | null): string[] {
  // Le prompt passe par stdin : --allowedTools est variadique et avalerait un argument positionnel.
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', cfg.permissionMode];
  args.push('--append-system-prompt', headlessNote(cwd, cfg.interactivePermissions));
  if (cfg.interactivePermissions) {
    args.push('--mcp-config', permissionMcpConfig(cfg, missionId), '--permission-prompt-tool', PERMISSION_TOOL);
  }
  if (cfg.allowedTools.length > 0) args.push('--allowedTools', cfg.allowedTools.join(','));
  if (cfg.model) args.push('--model', cfg.model);
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  return args;
}

async function resolveResume(store: Store, mission: Mission, sink: EventSink): Promise<string | null> {
  if (!mission.parent_id) return null;
  const parent = await store.getMission(mission.parent_id);
  if (!parent?.session_id) {
    sink.info('Mission parente sans session : démarrage d’une nouvelle conversation.', 'warn');
    return null;
  }
  if (parent.workspace !== mission.workspace) {
    sink.info('La mission parente est dans un autre dossier : reprise impossible.', 'warn');
    return null;
  }
  return parent.session_id;
}

/**
 * Exécute une mission avec `claude -p` dans son dossier de travail et diffuse chaque
 * événement stream-json vers Supabase. `signal` permet au worker d'interrompre la mission à l'arrêt.
 */
export async function runMission(
  mission: Mission,
  cfg: WorkerConfig,
  store: Store,
  signal: AbortSignal,
): Promise<void> {
  const cwd = cfg.workspaces[mission.workspace];
  const sink = new EventSink(store, mission.id);
  sink.info(`Mission démarrée dans « ${mission.workspace} »`);

  const resumeSessionId = await resolveResume(store, mission, sink);
  const before = await snapshotDirty(cwd).catch(() => null);
  const toolFiles = new Set<string>();
  let sessionId: string | null = null;
  let resultEvent: StreamEvent | null = null;
  let stderrTail = '';
  let cancelled = false;

  const child = spawn(cfg.claudeBin, buildArgs(cfg, cwd, mission.id, resumeSessionId), {
    cwd,
    // Laisse au serveur de permissions le temps d'attendre la décision de l'utilisateur.
    env: { ...process.env, MCP_TOOL_TIMEOUT: String(cfg.permissionTimeoutMs + 60_000) },
    stdio: ['pipe', 'pipe', 'pipe'],
    // Groupe de processus dédié pour pouvoir tuer aussi les commandes lancées par l'agent.
    detached: process.platform !== 'win32',
  });

  const kill = (sig: NodeJS.Signals) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      /* déjà terminé */
    }
  };
  const stop = (reason: string) => {
    if (cancelled) return;
    cancelled = true;
    sink.info(reason, 'warn');
    kill('SIGTERM');
    setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS).unref();
  };

  const onAbort = () => stop('Worker arrêté : mission interrompue.');
  signal.addEventListener('abort', onAbort, { once: true });
  const statusTimer = setInterval(() => {
    store
      .getStatus(mission.id)
      .then((status) => {
        if (status === 'cancel_requested') stop('Annulation demandée depuis MarIA.');
      })
      .catch((err: Error) => console.error(`[maria] ${err.message}`));
  }, STATUS_POLL_MS);

  child.stdin.end(mission.prompt);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL);
  });

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      sink.info(line, 'warn');
      return;
    }
    if (event.type === 'system' && event.subtype === 'init' && event.session_id && !sessionId) {
      sessionId = event.session_id;
      void store.update(mission.id, { session_id: sessionId }).catch((err: Error) => console.error(`[maria] ${err.message}`));
    }
    if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type !== 'tool_use') continue;
        const { name, input } = block as ToolUseBlock;
        const file = fileFromToolUse(cwd, name, input ?? {});
        if (file) toolFiles.add(file);
      }
    }
    if (event.type === 'result') resultEvent = event;
    sink.push(event);
  });

  const exit = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, error }));
    child.once('close', (code) => resolve({ code }));
  });

  clearInterval(statusTimer);
  signal.removeEventListener('abort', onAbort);
  lines.close();

  const after = before ? await snapshotDirty(cwd).catch(() => null) : null;
  const gitFiles = before && after ? diffSnapshots(before, after) : [];
  const files = [...new Set([...gitFiles, ...toolFiles])]
    .filter((f) => !cfg.ignorePaths.some((prefix) => f.startsWith(prefix)))
    .sort();

  const result = resultEvent as StreamEvent | null;
  let status: MissionStatus;
  let error: string | null = null;
  if (cancelled) {
    status = 'cancelled';
  } else if (exit.error) {
    status = 'failed';
    error = `Impossible de lancer « ${cfg.claudeBin} » : ${exit.error.message}`;
  } else if (exit.code === 0 && result && !result.is_error) {
    status = 'completed';
  } else {
    status = 'failed';
    error = (result?.is_error && result.result) || stderrTail.trim() || `claude a quitté avec le code ${exit.code}`;
  }

  await store.expirePermissions([mission.id]).catch((err: Error) => console.error(`[maria] ${err.message}`));
  sink.info(status === 'completed' ? 'Mission terminée.' : `Mission ${status === 'cancelled' ? 'annulée' : 'en échec'}.`);
  await sink.flush();
  await store.update(mission.id, {
    status,
    error,
    result: result?.result ?? null,
    cost_usd: result?.total_cost_usd ?? null,
    session_id: sessionId ?? result?.session_id ?? null,
    files_changed: files,
    finished_at: new Date().toISOString(),
  });
}

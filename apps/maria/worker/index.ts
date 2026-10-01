// Worker MarIA : récupère les missions en attente dans Supabase et les exécute avec Claude Code.
// Lancement : npm run worker (depuis apps/maria, avec .env.local rempli).
import { loadConfig } from './config';
import { runMission } from './runner';
import { Store } from './store';

const HEARTBEAT_MS = 30_000;

async function main(): Promise<void> {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    throw new Error(`Node.js ${process.versions.node} détecté : MarIA nécessite Node.js 22 ou plus (nvm install 22 && nvm use 22).`);
  }
  const cfg = loadConfig();
  const store = new Store(cfg.supabaseUrl, cfg.serviceRoleKey);
  const names = Object.keys(cfg.workspaces);

  await store.registerWorkspaces(names);
  const orphans = await store.failOrphans(names);
  if (orphans > 0) console.log(`[maria] ${orphans} mission(s) orpheline(s) marquée(s) en échec`);
  console.log(`[maria] worker prêt — dossiers : ${names.map((n) => `${n} → ${cfg.workspaces[n]}`).join(', ')}`);
  console.log(`[maria] permissions : mode ${cfg.permissionMode}, outils autorisés : ${cfg.allowedTools.join(', ') || '(aucun)'}`);

  // Une mission à la fois par dossier : deux agents dans le même dossier se marcheraient dessus.
  const running = new Map<string, Promise<void>>();
  const shutdown = new AbortController();
  let polling = false;

  const poll = async () => {
    if (polling || shutdown.signal.aborted) return;
    polling = true;
    try {
      for (;;) {
        const idle = names.filter((n) => !running.has(n));
        if (idle.length === 0) break;
        const mission = await store.claimNext(idle);
        if (!mission) break;
        console.log(`[maria] mission ${mission.id} → ${mission.workspace}`);
        const run = runMission(mission, cfg, store, shutdown.signal)
          .catch(async (err: Error) => {
            console.error(`[maria] mission ${mission.id} : ${err.message}`);
            await store
              .update(mission.id, { status: 'failed', error: err.message, finished_at: new Date().toISOString() })
              .catch(() => undefined);
          })
          .finally(() => running.delete(mission.workspace));
        running.set(mission.workspace, run);
      }
    } catch (err) {
      console.error(`[maria] ${(err as Error).message}`);
    } finally {
      polling = false;
    }
  };

  const pollTimer = setInterval(() => void poll(), cfg.pollMs);
  const heartbeatTimer = setInterval(() => {
    store.registerWorkspaces(names).catch((err: Error) => console.error(`[maria] ${err.message}`));
  }, HEARTBEAT_MS);
  void poll();

  const stop = async (sig: string) => {
    if (shutdown.signal.aborted) process.exit(1); // second Ctrl+C : sortie immédiate
    console.log(`[maria] ${sig} reçu, arrêt des missions en cours…`);
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    shutdown.abort();
    await Promise.allSettled(running.values());
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((err: Error) => {
  console.error(`[maria] ${err.message}`);
  process.exit(1);
});

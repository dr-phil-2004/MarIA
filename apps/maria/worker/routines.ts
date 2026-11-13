// Routines planifiées : à chaque battement, le worker crée les missions des routines arrivées à échéance.
import { nextRun } from '../src/lib/cron';
import type { Routine } from '../src/lib/types';
import type { Store } from './store';

/** Erreurs de planning déjà signalées (une seule fois par routine et par message). */
const reported = new Map<string, string>();

function report(routine: Routine, message: string) {
  if (reported.get(routine.id) === message) return;
  reported.set(routine.id, message);
  console.error(`[maria] routine « ${routine.name} » : ${message}`);
}

/**
 * Une échéance manquée (PC éteint) ne déclenche qu'une seule exécution au retour du worker,
 * puis le planning reprend à partir de maintenant.
 */
export async function fireDueRoutines(store: Store, workspaces: string[], now = new Date()): Promise<void> {
  for (const routine of await store.dueRoutines(workspaces, now)) {
    let next: Date | null;
    try {
      next = nextRun(routine.cron ?? '', routine.timezone, now);
    } catch (err) {
      report(routine, `planning invalide (${(err as Error).message})`);
      continue;
    }
    // Routine jamais planifiée : on fixe seulement sa première échéance.
    const fire = routine.next_run_at !== null;
    if (!(await store.claimRoutine(routine, next, fire))) continue;
    if (!fire) continue;
    if (routine.skip_if_running && (await store.routineBusy(routine.id))) {
      console.log(`[maria] routine « ${routine.name} » : exécution précédente encore en cours, échéance passée`);
      continue;
    }
    const id = await store.queueMission({ prompt: routine.prompt, workspace: routine.workspace, use_worktree: routine.use_worktree, routine_id: routine.id, provider: routine.provider, model: routine.model });
    reported.delete(routine.id);
    console.log(`[maria] routine « ${routine.name} » → mission ${id}${next ? ` (prochaine : ${next.toISOString()})` : ''}`);
  }
}

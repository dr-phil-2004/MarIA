import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Mission, MissionStatus, StreamEvent } from '../src/lib/types';

const MAX_STRING = 4000;

/** Tronque les longues chaînes (sorties d'outils, contenus de fichiers) avant stockage. */
function compact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… [${value.length - MAX_STRING} caractères tronqués]` : value;
  }
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compact(v)]));
  }
  return value;
}

export class Store {
  private readonly db: SupabaseClient<any, 'maria'>;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false }, db: { schema: 'maria' } });
  }

  async registerWorkspaces(names: string[]): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.db
      .from('workspaces')
      .upsert(names.map((name) => ({ name, last_seen_at: now })));
    if (error) throw new Error(`registerWorkspaces: ${error.message}`);
  }

  /** Missions restées "running" après un arrêt brutal du worker. */
  async failOrphans(names: string[]): Promise<number> {
    const { data, error } = await this.db
      .from('missions')
      .update({ status: 'failed', error: 'Le worker a redémarré pendant la mission', finished_at: new Date().toISOString() })
      .in('workspace', names)
      .in('status', ['running', 'cancel_requested'])
      .select('id');
    if (error) throw new Error(`failOrphans: ${error.message}`);
    return data.length;
  }

  async claimNext(workspaces: string[]): Promise<Mission | null> {
    const { data, error } = await this.db.rpc('claim_next_mission', { p_workspaces: workspaces });
    if (error) throw new Error(`claimNext: ${error.message}`);
    const rows = data as Mission[] | null;
    return rows?.[0] ?? null;
  }

  async getMission(id: string): Promise<Mission | null> {
    const { data, error } = await this.db.from('missions').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getMission: ${error.message}`);
    return data as Mission | null;
  }

  async getStatus(id: string): Promise<MissionStatus | null> {
    const { data, error } = await this.db.from('missions').select('status').eq('id', id).maybeSingle();
    if (error) throw new Error(`getStatus: ${error.message}`);
    return (data?.status as MissionStatus | undefined) ?? null;
  }

  async update(id: string, patch: Partial<Mission>): Promise<void> {
    const { error } = await this.db.from('missions').update(patch).eq('id', id);
    if (error) throw new Error(`update: ${error.message}`);
  }

  async insertEvents(rows: Array<{ mission_id: string; seq: number; event: StreamEvent }>): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.db.from('mission_events').insert(
      rows.map(({ mission_id, seq, event }) => ({
        mission_id,
        seq,
        type: event.type,
        payload: compact(event),
      })),
    );
    if (error) throw new Error(`insertEvents: ${error.message}`);
  }
}

/** Regroupe les événements et les écrit par lots pour limiter les allers-retours. */
export class EventSink {
  private queue: Array<{ mission_id: string; seq: number; event: StreamEvent }> = [];
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: Store,
    private readonly missionId: string,
    private readonly intervalMs = 300,
  ) {}

  push(event: StreamEvent): void {
    this.queue.push({ mission_id: this.missionId, seq: this.seq++, event });
    if (this.queue.length >= 50) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), this.intervalMs);
  }

  info(text: string, level: StreamEvent['level'] = 'info'): void {
    this.push({ type: 'maria', level, text });
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.queue;
    this.queue = [];
    this.flushing = this.flushing.then(() =>
      this.store.insertEvents(batch).catch((err: Error) => console.error(`[maria] ${err.message}`)),
    );
    return this.flushing;
  }
}

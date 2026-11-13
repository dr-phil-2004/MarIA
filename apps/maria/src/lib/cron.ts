// Plannings des routines : expressions cron à 5 champs (minute heure jour mois jour-de-semaine),
// évaluées dans un fuseau horaire IANA. Partagé par l'interface (prochaine exécution) et le worker.

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
  dayAny: boolean;
  weekdayAny: boolean;
}

const RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function parseField(text: string, [min, max]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`champ cron invalide : ${part}`);
    const step = m[4] ? Number(m[4]) : 1;
    const from = m[1] === '*' ? min : Number(m[2]);
    const to = m[1] === '*' ? max : m[3] ? Number(m[3]) : m[4] ? max : from;
    if (step < 1 || from < min || to > max || from > to) throw new Error(`valeur hors limites : ${part}`);
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('5 champs attendus : minute heure jour mois jour-de-semaine');
  const [minute, hour, day, month, weekday] = parts.map((p, i) => parseField(p, RANGES[i]));
  if (weekday.has(7)) weekday.add(0);
  return { minute, hour, day, month, weekday, dayAny: parts[2] === '*', weekdayAny: parts[4] === '*' };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Date et heure murales d'un instant dans un fuseau. */
function wallClock(date: Date, fmt: Intl.DateTimeFormat) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { minute: Number(p.minute), hour: Number(p.hour) % 24, day: Number(p.day), month: Number(p.month), weekday: WEEKDAY[p.weekday] };
}

function matches(f: CronFields, w: ReturnType<typeof wallClock>): boolean {
  if (!f.minute.has(w.minute) || !f.hour.has(w.hour) || !f.month.has(w.month)) return false;
  // Comme cron : si jour et jour-de-semaine sont tous deux restreints, l'un OU l'autre suffit.
  if (f.dayAny || f.weekdayAny) return f.day.has(w.day) && f.weekday.has(w.weekday);
  return f.day.has(w.day) || f.weekday.has(w.weekday);
}

/** Prochaine exécution strictement après `from` (null si aucune dans l'année qui vient). */
export function nextRun(expr: string, timezone: string, from: Date = new Date()): Date | null {
  const f = parseCron(expr);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    minute: 'numeric',
    hour: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
  });
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  // Les fuseaux ont des décalages en minutes entières : on avance minute par minute,
  // en sautant les heures entières qui ne peuvent pas correspondre.
  for (let i = 0; i < 366 * 24 * 60; ) {
    const w = wallClock(t, fmt);
    if (!f.hour.has(w.hour) || !f.month.has(w.month)) {
      const skip = 60 - w.minute;
      t.setUTCMinutes(t.getUTCMinutes() + skip);
      i += skip;
      continue;
    }
    if (matches(f, w)) return t;
    t.setUTCMinutes(t.getUTCMinutes() + 1);
    i++;
  }
  return null;
}

export const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export type SchedulePreset =
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekdays'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'custom'; cron: string };

export function presetToCron(p: SchedulePreset): string {
  switch (p.kind) {
    case 'hourly':
      return `${p.minute} * * * *`;
    case 'daily':
      return `${p.minute} ${p.hour} * * *`;
    case 'weekdays':
      return `${p.minute} ${p.hour} * * 1-5`;
    case 'weekly':
      return `${p.minute} ${p.hour} * * ${p.weekday}`;
    case 'custom':
      return p.cron.trim();
  }
}

/** Reconnaît les plannings simples pour les réafficher dans le formulaire. */
export function cronToPreset(cron: string): SchedulePreset {
  const parts = cron.trim().split(/\s+/);
  const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : NaN);
  if (parts.length === 5 && parts[2] === '*' && parts[3] === '*') {
    const [mi, h, , , wd] = parts;
    const minute = num(mi);
    if (!Number.isNaN(minute)) {
      if (h === '*' && wd === '*') return { kind: 'hourly', minute };
      const hour = num(h);
      if (!Number.isNaN(hour)) {
        if (wd === '*') return { kind: 'daily', hour, minute };
        if (wd === '1-5') return { kind: 'weekdays', hour, minute };
        const weekday = num(wd);
        if (!Number.isNaN(weekday) && weekday <= 7) return { kind: 'weekly', weekday: weekday % 7, hour, minute };
      }
    }
  }
  return { kind: 'custom', cron };
}

const hm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** Description en français : « Chaque lundi à 09:00 ». */
export function describeCron(cron: string): string {
  const p = cronToPreset(cron);
  switch (p.kind) {
    case 'hourly':
      return p.minute === 0 ? 'Toutes les heures' : `Toutes les heures à la minute ${p.minute}`;
    case 'daily':
      return `Chaque jour à ${hm(p.hour, p.minute)}`;
    case 'weekdays':
      return `Du lundi au vendredi à ${hm(p.hour, p.minute)}`;
    case 'weekly':
      return `Chaque ${WEEKDAYS_FR[p.weekday]} à ${hm(p.hour, p.minute)}`;
    case 'custom':
      return `Cron « ${p.cron} »`;
  }
}

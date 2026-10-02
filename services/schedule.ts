/**
 * Scheduled bot requests: "every weekday at 9:00, @bot do this". Pure — the
 * worker's cron (worker/src/schedules.ts) and the app share it.
 *
 * The cron ticks every STEP_MINUTES, so a schedule fires in the tick of the
 * slot its time falls in: 09:03 fires at 09:00. The app offers only times on
 * the step, so what you pick is what you get.
 */

export const STEP_MINUTES = 5;

export interface ScheduleSpec {
    /** Local time, "HH:MM". */
    time: string;
    /** Days of the week, 0 = Sunday … 6 = Saturday; empty means every day. */
    days: number[];
    /** IANA time zone the time is in, e.g. "Asia/Almaty". */
    tz: string;
}

export interface Schedule extends ScheduleSpec {
    id: string;
    text: string;
    bot: string;
    channelId: string;
    channelName: string;
    createdBy: string;
    createdByName: string;
    enabled: boolean;
    createdAt: number;
    lastRunAt?: number;
    lastError?: string;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export const minutesOf = (time: string): number | null => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** The weekday and minute of the day at `at` in `tz`; UTC when the zone is unknown. */
export const localTime = (at: number, tz: string): { day: number, minutes: number } => {
    let format: Intl.DateTimeFormat;
    try {
        format = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    } catch {
        format = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    }
    const parts = Object.fromEntries(format.formatToParts(new Date(at)).map(p => [p.type, p.value]));
    return { day: WEEKDAYS[parts.weekday] ?? 0, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
};

/** Whether the tick at `at` is the one this schedule fires in. */
export const isDue = (spec: ScheduleSpec, at: number, step = STEP_MINUTES): boolean => {
    const target = minutesOf(spec.time);
    if (target === null) return false;
    const now = localTime(at, spec.tz);
    if (spec.days.length && !spec.days.includes(now.day)) return false;
    return now.minutes - now.minutes % step === target - target % step;
};

/** A run this recent means the tick was already handled (a retried cron, say). */
export const ranRecently = (lastRunAt: number | undefined, at: number, step = STEP_MINUTES): boolean =>
    Boolean(lastRunAt) && at - lastRunAt! < 2 * step * 60_000;

const DAY_NAMES: Record<string, string[]> = {
    ru: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    kk: ['жс', 'дс', 'сс', 'ср', 'бс', 'жм', 'сб']
};

/** "пн–пт 09:00", "ежедневно 18:30", "сб, вс 10:00". */
export const describeSchedule = (spec: ScheduleSpec, language = 'ru'): string => {
    const names = DAY_NAMES[language] || DAY_NAMES.ru;
    const days = [...new Set(spec.days)].sort((a, b) => a - b);
    const every = language === 'en' ? 'daily' : language === 'kk' ? 'күн сайын' : 'ежедневно';
    let label: string;
    if (!days.length || days.length === 7) label = every;
    else if (days.join() === '1,2,3,4,5') label = `${names[1]}–${names[5]}`;
    else label = days.map(d => names[d]).join(', ');
    return `${label} ${spec.time}`;
};

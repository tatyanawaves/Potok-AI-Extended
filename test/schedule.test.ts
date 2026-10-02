import { describe, it, expect } from 'vitest';
import { isDue, localTime, ranRecently, describeSchedule, minutesOf } from '../services/schedule';

// Wednesday 2026-09-30, 04:00 UTC = 09:00 in Almaty (UTC+5).
const WED_0400_UTC = Date.UTC(2026, 8, 30, 4, 0, 0);

describe('schedule', () => {
    it('reads local time in the zone', () => {
        expect(localTime(WED_0400_UTC, 'Asia/Almaty')).toEqual({ day: 3, minutes: 9 * 60 });
        expect(localTime(WED_0400_UTC, 'UTC')).toEqual({ day: 3, minutes: 4 * 60 });
        expect(localTime(WED_0400_UTC, 'Not/AZone')).toEqual({ day: 3, minutes: 4 * 60 });
    });

    it('fires in the tick of its slot', () => {
        const spec = { time: '09:00', days: [], tz: 'Asia/Almaty' };
        expect(isDue(spec, WED_0400_UTC)).toBe(true);
        expect(isDue(spec, WED_0400_UTC + 2 * 60_000)).toBe(true);
        expect(isDue(spec, WED_0400_UTC + 5 * 60_000)).toBe(false);
        expect(isDue(spec, WED_0400_UTC - 60_000)).toBe(false);
        expect(isDue({ ...spec, time: '09:03' }, WED_0400_UTC)).toBe(true);
    });

    it('keeps to its days', () => {
        expect(isDue({ time: '09:00', days: [1, 2, 3, 4, 5], tz: 'Asia/Almaty' }, WED_0400_UTC)).toBe(true);
        expect(isDue({ time: '09:00', days: [0, 6], tz: 'Asia/Almaty' }, WED_0400_UTC)).toBe(false);
    });

    it('turns down bad times', () => {
        expect(minutesOf('24:00')).toBeNull();
        expect(isDue({ time: '9am', days: [], tz: 'UTC' }, WED_0400_UTC)).toBe(false);
    });

    it('does not run twice in one tick', () => {
        expect(ranRecently(WED_0400_UTC - 60_000, WED_0400_UTC)).toBe(true);
        expect(ranRecently(WED_0400_UTC - 24 * 3600_000, WED_0400_UTC)).toBe(false);
        expect(ranRecently(undefined, WED_0400_UTC)).toBe(false);
    });

    it('describes itself', () => {
        expect(describeSchedule({ time: '09:00', days: [1, 2, 3, 4, 5], tz: 'UTC' })).toBe('пн–пт 09:00');
        expect(describeSchedule({ time: '18:30', days: [], tz: 'UTC' })).toBe('ежедневно 18:30');
        expect(describeSchedule({ time: '10:00', days: [6, 0], tz: 'UTC' }, 'en')).toBe('Sun, Sat 10:00');
    });
});

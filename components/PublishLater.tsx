import React from 'react';
import { PUBLISH_STEP_MINUTES, scheduledPostsAvailable } from '../services/scheduledPosts';

/**
 * "Publish later" in a post dialog: off by default; on, a date and time.
 * value is the moment in ms, or null for "now".
 */

const pad = (n: number) => String(n).padStart(2, '0');
/** A Date as the value of an <input type="datetime-local">, in local time. */
export const toLocalInput = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** An hour from now, on a five-minute mark: a sensible first suggestion. */
export const defaultPublishAt = (now = Date.now()) => {
    const step = PUBLISH_STEP_MINUTES * 60_000;
    return Math.ceil((now + 60 * 60_000) / step) * step;
};

interface PublishLaterProps {
    value: number | null;
    onChange: (value: number | null) => void;
    language?: string;
}

const PublishLater: React.FC<PublishLaterProps> = ({ value, onChange, language }) => {
    if (!scheduledPostsAvailable()) return null;
    const en = language === 'en';
    const on = value !== null;
    return (
        <div className="mb-4 space-y-2">
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                <input
                    type="checkbox"
                    checked={on}
                    onChange={e => onChange(e.target.checked ? defaultPublishAt() : null)}
                    className="accent-cyan-500"
                />
                🕒 {en ? 'Publish later' : 'Опубликовать позже'}
            </label>
            {on && (
                <div>
                    <input
                        type="datetime-local"
                        value={toLocalInput(value!)}
                        min={toLocalInput(Date.now() + PUBLISH_STEP_MINUTES * 60_000)}
                        step={PUBLISH_STEP_MINUTES * 60}
                        onChange={e => { const ms = new Date(e.target.value).getTime(); if (Number.isFinite(ms)) onChange(ms); }}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                    />
                    <p className="mt-1 text-[10px] text-slate-600">
                        {en
                            ? `Published by the server, even with the app closed, within ${PUBLISH_STEP_MINUTES} minutes of this time.`
                            : `Опубликует сервер, даже если приложение закрыто, в пределах ${PUBLISH_STEP_MINUTES} минут от этого времени.`}
                    </p>
                </div>
            )}
        </div>
    );
};

export default PublishLater;

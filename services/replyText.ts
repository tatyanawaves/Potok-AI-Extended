/**
 * A bot reply that came back as a JSON object — {"summary": …, "facts": […]}
 * — as readable text. Some models answer in JSON after seeing JSON earlier
 * in the channel; shown as text, and kept as text in the history, the habit
 * does not spread to the next reply.
 *
 * Anything that is not such an object is returned unchanged.
 */

const TEXT_KEYS = ['reply', 'answer', 'response', 'summary', 'report', 'result', 'text', 'message', 'content'];
const LIST_KEYS = ['steps', 'facts', 'notes', 'items', 'results', 'details'];

const asText = (value: unknown): string =>
    typeof value === 'string' ? value
        : typeof value === 'number' || typeof value === 'boolean' ? String(value)
            : value && typeof value === 'object' ? JSON.stringify(value)
                : '';

export const plainReply = (raw: string | null | undefined): string => {
    const text = (raw || '').trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
    const body = fenced ? fenced[1] : text;
    if (!body.startsWith('{') || !body.endsWith('}')) return raw || '';

    let data: Record<string, unknown>;
    try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw || '';
        data = parsed;
    } catch {
        return raw || '';
    }

    const parts: string[] = [];
    for (const key of TEXT_KEYS) {
        const value = data[key];
        if (typeof value === 'string' && value.trim()) parts.push(value.trim());
    }
    for (const key of LIST_KEYS) {
        const value = data[key];
        if (Array.isArray(value) && value.length) parts.push(value.map(v => `- ${asText(v)}`).join('\n'));
        else if (typeof value === 'string' && value.trim()) parts.push(value.trim());
    }
    // Not a reply-shaped object (real data the person asked for): left as it is.
    return parts.length ? parts.join('\n\n') : raw || '';
};

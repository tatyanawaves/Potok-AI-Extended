/**
 * Pictures for bots. An image attached to one of the latest messages goes to
 * the model as an image, not just a file name; a model that cannot take
 * images gets the request again without them, and a note saying so.
 */

export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Only the newest messages bring their pictures; older ones would cost a lot for little. */
export const IMAGE_MESSAGES = 2;

export type ContentPart =
    | { type: 'text', text: string }
    | { type: 'image_url', image_url: { url: string } };

export interface ImageRef { key: string, name: string, size: number, contentType: string }

export const isImage = (a: { contentType: string, size: number }): boolean =>
    /^image\/(png|jpe?g|gif|webp)$/i.test(a.contentType) && a.size <= MAX_IMAGE_BYTES;

/** The images worth showing, newest messages first, at most MAX_IMAGES. */
export const imagesToShow = <M extends { attachments?: ImageRef[] }>(window: M[]): Array<{ message: M, image: ImageRef }> => {
    const picked: Array<{ message: M, image: ImageRef }> = [];
    for (const message of window.slice(-IMAGE_MESSAGES).reverse()) {
        for (const image of (message.attachments || []).filter(isImage)) {
            if (picked.length >= MAX_IMAGES) return picked;
            picked.push({ message, image });
        }
    }
    return picked;
};

/** Text plus pictures, in the shape OpenAI-compatible APIs take. */
export const withPictures = (text: string, dataUrls: string[]): ContentPart[] =>
    [{ type: 'text', text }, ...dataUrls.map(url => ({ type: 'image_url' as const, image_url: { url } }))];

/** The provider refused pictures (the model has no vision). */
export const refusedImages = (error: unknown): boolean =>
    /image|vision|multimodal|modalit/i.test(error instanceof Error ? error.message : String(error));

/** The same conversation with every picture taken out, and a note in its place. */
export const withoutPictures = <T extends { content: unknown }>(messages: T[]): T[] =>
    messages.map(m => Array.isArray(m.content)
        ? {
            ...m,
            content: (m.content as ContentPart[]).map(p => p.type === 'text' ? p.text : '[an image was attached; this model cannot see images]').join('\n')
        }
        : m);

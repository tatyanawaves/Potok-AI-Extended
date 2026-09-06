import React, { useState, useEffect } from 'react';
import { MessageAttachment } from '../types';
import {
    fetchAttachmentUrl, saveAttachment, isImage, formatSize
} from '../services/attachments';

/**
 * One attachment inside a message.
 *
 * Always framed and labelled with its name and size, whatever it is. An image
 * alone is not enough of an affordance: a small one, a broken one, or one
 * still loading is indistinguishable from no attachment at all.
 *
 * The preview and the download are separate controls. Making the whole tile a
 * download button meant clicking a photo asked the browser where to save it,
 * when looking at it is what a click on a picture is for.
 *
 * Images are fetched into an object URL rather than linked directly, because
 * the worker only serves a file to an authenticated participant and a bare src
 * carries no credentials. The URL is revoked on unmount, since an undisposed
 * blob keeps the file in memory for the life of the page.
 */
export const AttachmentView: React.FC<{
    attachment: MessageAttachment;
    failedLabel: string;
    saveLabel: string;
    onOpen: (url: string, attachment: MessageAttachment) => void;
}> = ({ attachment, failedLabel, saveLabel, onOpen }) => {
    const [preview, setPreview] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const wantsPreview = isImage(attachment);

    useEffect(() => {
        if (!wantsPreview) return;

        let url: string | null = null;
        let cancelled = false;

        fetchAttachmentUrl(attachment)
            .then(objectUrl => {
                url = objectUrl;
                if (cancelled) {
                    URL.revokeObjectURL(objectUrl);
                    return;
                }
                setPreview(objectUrl);
            })
            .catch(() => setFailed(true));

        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [attachment, wantsPreview]);

    return (
        <div className="mt-2 rounded-lg border border-slate-700 bg-slate-950/60 overflow-hidden">
            {wantsPreview && (
                <button
                    onClick={() => preview && onOpen(preview, attachment)}
                    disabled={!preview}
                    className="block w-full bg-slate-900/60 border-b border-slate-800 hover:bg-slate-900 transition-colors disabled:cursor-default"
                >
                    {preview ? (
                        <img
                            src={preview}
                            alt={attachment.name}
                            // A tiny image would otherwise render as a speck;
                            // min-height keeps every preview a visible tile.
                            className="max-h-56 max-w-full mx-auto object-contain"
                            style={{ minHeight: '3rem' }}
                        />
                    ) : (
                        <span className="flex items-center justify-center h-16 text-[10px] font-mono text-slate-600">
                            {failed ? failedLabel : '…'}
                        </span>
                    )}
                </button>
            )}

            <div className="flex items-center space-x-2 px-3 py-2">
                <span className="text-base shrink-0">{wantsPreview ? '🖼' : '📎'}</span>
                <span className="min-w-0 flex-1">
                    <span className="text-xs text-slate-200 truncate block">{attachment.name}</span>
                    <span className="text-[10px] text-slate-500">
                        {failed ? failedLabel : formatSize(attachment.size)}
                    </span>
                </span>
                <button
                    onClick={() => saveAttachment(attachment).catch(() => setFailed(true))}
                    className="shrink-0 text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40 transition-colors"
                >
                    {saveLabel}
                </button>
            </div>
        </div>
    );
};


/**
 * Full-size view of an opened image.
 *
 * Lives here beside AttachmentView so both chat surfaces get the same
 * behaviour: the header floats over the picture rather than taking a strip of
 * its height, and clicking toggles between fitted and actual size, since
 * fitting cannot show detail in a large file.
 */
export const ImageLightbox: React.FC<{
    url: string;
    name: string;
    zoomLabel: string;
    fitLabel: string;
    onClose: () => void;
}> = ({ url, name, zoomLabel, fitLabel, onClose }) => {
    const [zoomed, setZoomed] = useState(false);

    return (
        <div className="fixed inset-0 z-[160] bg-black/95 backdrop-blur-sm" onClick={onClose}>
            <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-5 py-3 bg-gradient-to-b from-black/70 to-transparent">
                <span className="text-sm text-slate-300 truncate">{name}</span>
                <div className="flex items-center space-x-3 shrink-0 ml-4">
                    <button
                        onClick={(e) => { e.stopPropagation(); setZoomed(z => !z); }}
                        className="text-[10px] font-mono uppercase tracking-wider text-slate-400 hover:text-white transition-colors"
                    >
                        {zoomed ? fitLabel : zoomLabel}
                    </button>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            <div className={`absolute inset-0 flex items-center justify-center ${zoomed ? 'overflow-auto' : ''}`}>
                <img
                    src={url}
                    alt={name}
                    onClick={(e) => { e.stopPropagation(); setZoomed(z => !z); }}
                    className={zoomed
                        ? 'max-w-none cursor-zoom-out'
                        : 'max-h-full max-w-full object-contain cursor-zoom-in'}
                />
            </div>
        </div>
    );
};

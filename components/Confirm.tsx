import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * "Are you sure?" inside the app instead of window.confirm.
 *
 * The browser's own dialog is blocked or never shown in embedded views (an
 * in-app browser pane, some webviews), where the button then seemed to do
 * nothing at all — the thought stream did not start. It also cannot be
 * styled or translated. useConfirm() resolves to true or false like it did.
 */

export interface ConfirmOptions {
    message: string;
    /** The button that goes ahead, e.g. "Удалить", "Запустить". */
    confirmLabel?: string;
    cancelLabel?: string;
    /** Red confirm button, for deleting and other things that cannot be undone. */
    danger?: boolean;
}

type Ask = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/** Asks the person to confirm; outside a provider, falls back to the browser's dialog. */
export const useConfirm = (): Ask => {
    const ask = useContext(ConfirmContext);
    return ask ?? (async options => window.confirm(typeof options === 'string' ? options : options.message));
};

export const ConfirmProvider: React.FC<{ language?: string, children: React.ReactNode }> = ({ language, children }) => {
    const [pending, setPending] = useState<{ options: ConfirmOptions, resolve: (ok: boolean) => void } | null>(null);
    const confirmButton = useRef<HTMLButtonElement>(null);

    const ask = useCallback<Ask>(options => new Promise<boolean>(resolve => {
        setPending({ options: typeof options === 'string' ? { message: options } : options, resolve });
    }), []);

    const close = (ok: boolean) => {
        pending?.resolve(ok);
        setPending(null);
    };

    useEffect(() => {
        if (!pending) return;
        confirmButton.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pending]);

    const en = language === 'en';
    const kk = language === 'kk';

    return (
        <ConfirmContext.Provider value={ask}>
            {children}
            {pending && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                    onClick={() => close(false)}
                >
                    <div
                        role="alertdialog"
                        aria-modal="true"
                        aria-label={pending.options.message}
                        className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">{pending.options.message}</p>
                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => close(false)}
                                className="px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider text-slate-400 hover:text-white hover:bg-slate-800"
                            >
                                {pending.options.cancelLabel || (en ? 'Cancel' : kk ? 'Болдырмау' : 'Отмена')}
                            </button>
                            <button
                                ref={confirmButton}
                                type="button"
                                onClick={() => close(true)}
                                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider text-white ${pending.options.danger
                                    ? 'bg-rose-700 hover:bg-rose-600'
                                    : 'bg-cyan-700 hover:bg-cyan-600'}`}
                            >
                                {pending.options.confirmLabel || (en ? 'OK' : kk ? 'Иә' : 'Да')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmContext.Provider>
    );
};

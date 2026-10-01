import React from 'react';

/** A bot asks to call a tool; the person allows or refuses, and may have the answer remembered. */

interface ToolApprovalDialogProps {
    request: { bot: string, tool: string, args: Record<string, any>, foreign: boolean };
    rememberAnswer: boolean;
    canRemember: boolean;
    t: any;
    onRemember: (value: boolean) => void;
    onAnswer: (allowed: boolean) => void;
}

const ToolApprovalDialog: React.FC<ToolApprovalDialogProps> = ({ request, rememberAnswer, canRemember, t, onRemember, onAnswer }) => (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl shadow-2xl max-w-md w-full p-6">
                <h3 className="text-lg font-bold font-display text-white mb-1">
                    {t.toolRequest || 'Запрос инструмента'}
                </h3>
                <p className="text-slate-500 text-xs mb-4">
                    <span className="text-indigo-300">{request.bot}</span>{' '}
                    {t.wantsToCall || 'хочет вызвать инструмент. Это действие в вашем подключённом аккаунте.'}
                </p>
                {request.foreign && (
                    <p className="text-amber-200/90 text-xs leading-relaxed mb-4 px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-500/30">
                        {t.foreignBotWarning || 'Этого бота настроили не вы: его инструкции и сервисы выбрал другой человек, а действие выполнится от вашего имени, на ваших ключах. Разрешайте, только если понимаете, зачем оно нужно.'}
                    </p>
                )}

                <div className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 mb-4">
                    <div className="text-[11px] font-mono text-emerald-400 break-all">
                        ⚒ {request.tool}
                    </div>
                    {Object.keys(request.args).length > 0 && (
                        <pre className="text-[10px] text-slate-500 mt-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                            {JSON.stringify(request.args, null, 2)}
                        </pre>
                    )}
                </div>

                {canRemember && (
                    <label className="flex items-start gap-2 mb-4 text-[11px] text-slate-400 cursor-pointer">
                        <input type="checkbox" checked={rememberAnswer} onChange={e => onRemember(e.target.checked)} className="mt-0.5 accent-emerald-500" />
                        <span>
                            {request.foreign
                                ? (t.rememberDenyOnly || 'Запомнить отказ для этого бота и инструмента (разрешение чужому боту каждый раз спрашивается заново)')
                                : (t.rememberAnswer || 'Запомнить ответ для этого бота и инструмента — больше не спрашивать')}
                        </span>
                    </label>
                )}

                <div className="flex space-x-3">
                    <button
                        onClick={() => onAnswer(false)}
                        className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-bold font-mono text-[10px] uppercase tracking-wider transition-colors"
                    >
                        {t.deny || 'Отклонить'}
                    </button>
                    <button
                        onClick={() => onAnswer(true)}
                        className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold font-mono text-[10px] uppercase tracking-wider shadow-lg shadow-emerald-900/20 transition-colors"
                    >
                        {t.allow || 'Разрешить'}
                    </button>
                </div>
            </div>
        </div>
);

export default ToolApprovalDialog;

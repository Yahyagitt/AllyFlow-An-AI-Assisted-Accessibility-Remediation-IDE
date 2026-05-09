"use client";

import {
    Code2, FileCode, SplitSquareHorizontal,
    Zap, Sparkles, Cpu, CheckCircle2, ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, memo } from "react";
import type { ScanStatus } from "./UrlInputBar";
import type { HealResponse } from "@/lib/scan-types";
import dynamic from "next/dynamic";

const DiffEditor = dynamic(
    () => import("@monaco-editor/react").then((m) => m.DiffEditor),
    { ssr: false, loading: () => <MonacoLoadingPlaceholder /> }
);

function MonacoLoadingPlaceholder() {
    return (
        <div className="flex items-center justify-center h-full min-h-[200px] gap-3 text-slate-500 text-sm">
            <div className="w-4 h-4 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
            Loading editor…
        </div>
    );
}

const MONACO_OPTIONS = {
    readOnly: false,
    originalEditable: false,
    renderSideBySide: true,
    minimap: { enabled: true }, // Turned back ON so you can see where diffs are in the scrollbar!
    scrollBeyondLastLine: false,
    fontSize: 12,
    lineHeight: 20,
    padding: { top: 12, bottom: 12 },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    diffWordWrap: "off" as const, // Turned off wrap for standard IDE feel
    lineNumbers: "on" as const,
    folding: true,
    renderLineHighlight: "all" as const,
};

const IDLE_BEFORE = `<!-- Paste a URL above and click Scan. -->`.trim();
const IDLE_AFTER = `<!-- Fixed HTML will appear here. -->`.trim();

interface DiffViewerProps {
    status: ScanStatus;
    beforeCode?: string; // This will now be the FULL document
    healResult?: HealResponse | null;
    activeViolationId?: string | null;
    isHealing?: boolean;
    onApplyFix?: (violationId: string, fullNewHtml: string) => void;
}

const MemoizedDiffEditor = memo(function MemoizedDiffEditor({
    original,
    modified,
    onMount,
}: {
    original: string;
    modified: string;
    onMount: (editor: any) => void;
}) {
    return (
        <DiffEditor
            height="100%"
            language="html"
            original={original}
            modified={modified}
            theme="vs-dark"
            options={MONACO_OPTIONS}
            onMount={onMount}
        />
    );
});

export default function DiffViewer({
    status,
    beforeCode,
    healResult,
    activeViolationId,
    isHealing = false,
    onApplyFix,
}: DiffViewerProps) {
    const [mounted, setMounted] = useState(false);
    const modifiedEditorRef = useRef<any>(null);

    useEffect(() => { setMounted(true); }, []);

    const handleEditorMount = (editor: any) => {
        modifiedEditorRef.current = editor.getModifiedEditor();
    };

    const hasHealResult = !!healResult;

    // ── THE FULL DOCUMENT DIFF LOGIC ──
    const originalHtml = beforeCode || IDLE_BEFORE;
    let modifiedHtml = originalHtml;

    if (hasHealResult && beforeCode) {
        // Find the exact broken snippet in the full doc and replace it with the fix!
        modifiedHtml = beforeCode.replace(healResult!.original, healResult!.fixed);
    } else if (!beforeCode) {
        modifiedHtml = IDLE_AFTER;
    }

    const showEditor = mounted && (status === "complete" || status === "idle" || hasHealResult);

    function handleApplyClick() {
        if (!healResult || !onApplyFix || !activeViolationId) return;

        // Grab the full customized document from the right side of the editor
        const fullNewHtml = modifiedEditorRef.current
            ? modifiedEditorRef.current.getValue()
            : modifiedHtml;

        onApplyFix(activeViolationId, fullNewHtml);
    }

    return (
        <section className="flex flex-col h-full bg-[#1e1e1e] border-l border-slate-700/50" aria-label="Code diff viewer">
            {/* ── Toolbar ── */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-slate-700/50 flex-shrink-0 min-h-[48px]">
                <div className="flex items-center gap-3">
                    <SplitSquareHorizontal className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest">
                        Master Document
                    </span>
                    {hasHealResult && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border bg-violet-500/10 border-violet-500/25 text-violet-400">
                            <Sparkles className="w-2.5 h-2.5" /> Pending Fix
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden sm:flex items-center gap-3 text-[11px]">
                        <span className="flex items-center gap-1 text-red-400/70"><FileCode className="w-3 h-3" /> Original File</span>
                        <span className="text-slate-600">→</span>
                        <span className="flex items-center gap-1 text-emerald-400/70"><Code2 className="w-3 h-3" /> Fixed (Editable)</span>
                    </div>

                    {hasHealResult && onApplyFix && (
                        <button
                            onClick={handleApplyClick}
                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 border border-emerald-500 text-white hover:bg-emerald-500 active:scale-95 transition-all shadow-sm shadow-emerald-900/50"
                        >
                            <ClipboardCheck className="w-3.5 h-3.5" />
                            Apply Fix to Document
                        </button>
                    )}
                </div>
            </div>

            {/* ── Monaco area ── */}
            <div className="relative flex-1 min-h-0 bg-[#1e1e1e]">
                {isHealing && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#1e1e1e]/80 backdrop-blur-sm">
                        <div className="w-10 h-10 rounded-full border-2 border-violet-500/30 border-t-violet-400 animate-spin" />
                        <p className="text-sm font-medium text-slate-300">Generating contextual fix…</p>
                    </div>
                )}
                {showEditor ? (
                    <MemoizedDiffEditor original={originalHtml} modified={modifiedHtml} onMount={handleEditorMount} />
                ) : (
                    !mounted && <MonacoLoadingPlaceholder />
                )}
            </div>
        </section>
    );
}
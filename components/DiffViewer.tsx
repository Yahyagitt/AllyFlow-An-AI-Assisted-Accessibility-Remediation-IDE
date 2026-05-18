"use client";
import {
    Code2, FileCode, SplitSquareHorizontal,
    Sparkles, ClipboardCheck,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
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
            <div className="w-4 h-4 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
            Loading editor…
        </div>
    );
}

const MONACO_OPTIONS: any = {
    readOnly: false,
    originalEditable: false,
    renderSideBySide: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 13,
    wordWrap: "on",
    diffWordWrap: "on",
};

const IDLE_BEFORE = ``.trim();
const IDLE_AFTER = ``.trim();

interface DiffViewerProps {
    status: ScanStatus;
    beforeCode?: string;
    healResult?: HealResponse | null;
    activeViolationId?: string | null;
    isHealing?: boolean;
    onApplyFix?: (violationId: string, fullNewHtml: string) => void;
}

export default function DiffViewer({
    status,
    beforeCode,
    healResult,
    activeViolationId,
    isHealing = false,
    onApplyFix,
}: DiffViewerProps) {
    const [mounted, setMounted] = useState(false);
    // This ref now directly holds the Monaco DiffEditor instance — no memo barrier.
    const diffEditorRef = useRef<any>(null);
    const [hasManualEdits, setHasManualEdits] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    // Reset manual-edit flag whenever the underlying document or fix changes
    useEffect(() => {
        setHasManualEdits(false);
    }, [beforeCode, healResult]);

    // ── onMount: capture the diff editor and wire up change detection ──────
    const handleEditorMount = useCallback((editor: any) => {
        if (!editor) return;
        diffEditorRef.current = editor;

        const original = editor.getOriginalEditor();
        const modified = editor.getModifiedEditor();
        if (original) original.updateOptions({ wordWrap: "on" });
        if (modified) {
            modified.updateOptions({ wordWrap: "on" });
            // Mark that the user has made manual edits
            modified.onDidChangeModelContent(() => {
                setHasManualEdits(true);
            });
        }
    }, []);

    // ── Compute what to show in each pane ──────────────────────────────────
    const hasHealResult = !!healResult;
    const originalHtml = beforeCode || IDLE_BEFORE;
    let modifiedHtml = originalHtml;

    if (hasHealResult && beforeCode) {
        // ── SPECIAL CASE: html-tag-regex patch (for html-has-lang etc.) ──
        if (healResult!.patchType === "html-tag-regex") {
            const langValue = healResult!.fixed; // e.g. "en"
            modifiedHtml = beforeCode.replace(
                /<html\b([^>]*?)(?:\s+lang=["'][^"']*["'])?([^>]*?)>/i,
                (_, before, after) => `<html${before} lang="${langValue}"${after}>`
            );
        } else {
            // Primary replace: literal match (works when whitespace is exact)
            let replaced = beforeCode.replace(healResult!.original, healResult!.fixed);

            // Fallback: collapse whitespace differences
            if (replaced === beforeCode && healResult!.original !== healResult!.fixed) {
                const escaped = healResult!.original
                    .trim()
                    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                    .replace(/\s+/g, "\\s+");
                try {
                    replaced = beforeCode.replace(new RegExp(escaped, "s"), healResult!.fixed);
                } catch {
                    // invalid regex — keep original
                }
            }

            modifiedHtml = replaced;
        }
    } else if (!beforeCode) {
        modifiedHtml = IDLE_AFTER;
    }

    const showEditor = mounted && (status === "complete" || status === "idle" || hasHealResult);
    const showApplyButton = hasHealResult || hasManualEdits;

    // ── Apply Fix: read current editor content (captures manual edits too) ──
    function handleApplyClick() {
        if (!onApplyFix) return;

        // getValue() from the MODIFIED pane — picks up any user edits on top of the AI fix
        const editorValue = diffEditorRef.current
            ?.getModifiedEditor()
            ?.getValue();

        const fullNewHtml = editorValue ?? modifiedHtml;
        onApplyFix(activeViolationId || "manual-edit", fullNewHtml);
        setHasManualEdits(false);
    }

    return (
        <section className="flex flex-col h-full bg-[#1e1e1e] border-l border-slate-700/50" aria-label="Code diff viewer">
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

                    {showApplyButton && onApplyFix && (
                        <button
                            type="button"
                            onClick={handleApplyClick}
                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-600 border border-emerald-500 text-white hover:bg-emerald-500 active:scale-95 transition-all shadow-sm shadow-emerald-900/50"
                        >
                            <ClipboardCheck className="w-3.5 h-3.5" />
                            Apply Fix to Document
                        </button>
                    )}
                </div>
            </div>

            <div className="relative flex-1 min-h-0 bg-[#1e1e1e]">
                {isHealing && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#1e1e1e]/80 backdrop-blur-sm">
                        <div className="w-10 h-10 rounded-full border-2 border-violet-500/30 border-t-violet-400 animate-spin" />
                        <p className="text-sm font-medium text-slate-300">Generating contextual fix…</p>
                    </div>
                )}
                {showEditor ? (
                    <DiffEditor
                        height="100%"
                        language="html"
                        original={originalHtml}
                        modified={modifiedHtml}
                        theme="vs-dark"
                        options={MONACO_OPTIONS}
                        onMount={handleEditorMount}
                    />
                ) : (
                    !mounted && <MonacoLoadingPlaceholder />
                )}
            </div>
        </section>
    );
}

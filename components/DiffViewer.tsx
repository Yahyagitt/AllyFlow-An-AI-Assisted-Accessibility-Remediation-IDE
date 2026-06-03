"use client";
import {
    Code2, FileCode, SplitSquareHorizontal,
    Sparkles, ClipboardCheck, RefreshCw, Sun, Moon,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { ScanStatus } from "./UrlInputBar";
import type { HealResponse } from "@/lib/scan-types";
import dynamic from "next/dynamic";

const DiffEditor = dynamic(
    () => import(/* webpackChunkName: "monaco-editor" */ "@monaco-editor/react").then((m) => m.DiffEditor),
    { ssr: false, loading: () => <MonacoLoadingPlaceholder /> }
);

function MonacoLoadingPlaceholder() {
    return (
        <div className="flex items-center justify-center h-full min-h-[200px] gap-3 text-slate-500 text-sm">
            <div className="w-4 h-4 rounded-full border-2 border-[#2222E3]/30 border-t-[#2222E3] animate-spin" />
            Loading editor…
        </div>
    );
}

const SCROLLBAR_OPTIONS = {
    verticalScrollbarSize: 6,
    horizontalScrollbarSize: 6,
    verticalSliderSize: 6,
    horizontalSliderSize: 6,
    alwaysConsumeMouseWheel: false,
};

const BASE_MONACO_OPTIONS: any = {
    readOnly: false,
    originalEditable: false,
    renderSideBySide: true,
    scrollBeyondLastLine: false,
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollbar: SCROLLBAR_OPTIONS,
};

const IDLE_BEFORE = ``.trim();
const IDLE_AFTER = ``.trim();

interface DiffViewerProps {
    status: ScanStatus;
    beforeCode?: string;
    healResult?: HealResponse | null;
    activeViolationId?: string | null;
    isHealing?: boolean;
    fontSize?: number;
    wordWrap?: "on" | "off";
    tabSize?: 2 | 4 | 8;
    minimap?: boolean;
    theme?: "vs-dark" | "vs";
    onApplyFix?: (violationId: string, fullNewHtml: string) => void;
    onRefix?: () => void;
    onRescan?: () => void;
    onToggleTheme?: () => void;
}

export default function DiffViewer({
    status,
    beforeCode,
    healResult,
    activeViolationId,
    isHealing = false,
    fontSize = 13,
    wordWrap = "on",
    tabSize = 4,
    minimap = false,
    theme = "vs-dark",
    onApplyFix,
    onRefix,
    onRescan,
    onToggleTheme,
}: DiffViewerProps) {
    const [mounted, setMounted] = useState(false);
    const diffEditorRef = useRef<any>(null);
    const [hasManualEdits, setHasManualEdits] = useState(false);

    const monacoOptions = useMemo(() => ({
        ...BASE_MONACO_OPTIONS,
        fontSize,
        wordWrap,
        diffWordWrap: wordWrap,
        tabSize,
        minimap: { enabled: minimap },
    }), [fontSize, wordWrap, tabSize, minimap]);

    useEffect(() => { setMounted(true); }, []);

    const updateSubEditors = useCallback((editor: any) => {
        if (!editor) return;
        const original = editor.getOriginalEditor();
        const modified = editor.getModifiedEditor();
        const opts = { wordWrap, scrollbar: SCROLLBAR_OPTIONS };
        if (original) original.updateOptions(opts);
        if (modified) modified.updateOptions(opts);
    }, [wordWrap]);

    useEffect(() => {
        setHasManualEdits(false);
        updateSubEditors(diffEditorRef.current);
    }, [beforeCode, healResult, wordWrap]);

    const handleEditorMount = useCallback((editor: any) => {
        if (!editor) return;
        diffEditorRef.current = editor;

        updateSubEditors(editor);
        const modified = editor.getModifiedEditor();
        if (modified) {
            modified.onDidChangeModelContent(() => {
                setHasManualEdits(true);
            });
        }
    }, [wordWrap]);

    // ── Compute full-document modified view ─────────────────────────────────
    // The right pane always shows the FULL masterHtml with the fix applied inline.
    // This means the Monaco diff highlights only the changed lines, not a 1-line snippet.
    const modifiedHtml = useMemo(() => {
        if (!healResult || !beforeCode) return beforeCode ?? IDLE_AFTER;

        // Special case: html-tag-regex patch
        if (healResult.patchType === "html-tag-regex") {
            const langValue = healResult.fixed;
            return beforeCode.replace(
                /<html\b([^>]*?)(?:\s+lang=["'][^"']*["'])?([^>]*?)>/i,
                (_, before, after) => `<html${before} lang="${langValue}"${after}>`
            );
        }

        // Primary replace: literal match
        let replaced = beforeCode.replace(healResult.original, healResult.fixed);

        // Fallback: only attempt if original is small enough to be safe
        if (
            replaced === beforeCode &&
            healResult.original !== healResult.fixed &&
            healResult.original.length <= 1500
        ) {
            try {
                const escaped = healResult.original
                    .trim()
                    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                    .replace(/\s+/g, "\\s+");
                const safeRegex = new RegExp(escaped, "s");
                const attempt = beforeCode.replace(safeRegex, healResult.fixed);
                if (attempt !== beforeCode) replaced = attempt;
            } catch {
                // Invalid regex — keep original document unchanged
            }
        }

        // Add branding comment if not already present
        if (!replaced.startsWith("<!-- Fixed with AllyFlow -->")) {
            replaced = "<!-- Fixed with AllyFlow -->\n" + replaced;
        }

        return replaced;
    }, [healResult, beforeCode]);

    const hasHealResult = !!healResult;
    const originalHtml = beforeCode || IDLE_BEFORE;
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
        <section className="flex flex-col h-full bg-[#111113] border-l border-white/[0.06]" aria-label="Code diff viewer">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#111113] border-b border-white/[0.06] flex-shrink-0 min-h-[38px]">
                <div className="flex items-center gap-2">
                    <SplitSquareHorizontal className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-normal text-slate-300 uppercase tracking-widest">
                        Master Document
                    </span>
                    {onRescan && (
                        <button
                            type="button"
                            onClick={onRescan}
                            className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md bg-slate-800 border border-slate-700/50 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:scale-95 transition-all"
                            title="Re-scan current URL"
                        >
                            <RefreshCw className="w-3 h-3" />
                            Re-Scan
                        </button>
                    )}
                    {onToggleTheme && (
                        <button
                            type="button"
                            onClick={onToggleTheme}
                            className="flex items-center justify-center w-6 h-6 rounded-lg hover:bg-white/[0.06] text-slate-500 hover:text-slate-300 transition-all"
                            title={theme === "vs-dark" ? "Switch to light theme" : "Switch to dark theme"}
                        >
                            {theme === "vs-dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                        </button>
                    )}
                    {hasHealResult && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-medium rounded-full px-1.5 py-0.5 border bg-[#2222E3]/10 border-[#2222E3]/25 text-[#2222E3]">
                            <Sparkles className="w-2 h-2" /> Pending Fix
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    <div className="hidden sm:flex items-center gap-2 text-[11px]">
                        <span className="flex items-center gap-1 text-red-400/70"><FileCode className="w-3 h-3" /> Original File</span>
                        <span className="text-slate-600">→</span>
                        <span className="flex items-center gap-1 text-emerald-400/70"><Code2 className="w-3 h-3" /> Fixed (Editable)</span>
                    </div>

                    {showApplyButton && onApplyFix && (
                        <button
                            type="button"
                            onClick={handleApplyClick}
                            className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md bg-emerald-600 border border-emerald-500 text-white hover:bg-emerald-500 active:scale-95 transition-all shadow-sm shadow-emerald-900/50"
                        >
                            <ClipboardCheck className="w-3 h-3" />
                            Apply Fix to Document
                        </button>
                    )}
                    {hasHealResult && onRefix && (
                        <button
                            type="button"
                            onClick={onRefix}
                            className="text-[11px] text-slate-500 hover:text-slate-300 underline transition-colors"
                        >
                            Regenerate fix
                        </button>
                    )}
                </div>
            </div>

            <div className={cn("relative flex-1 min-h-0", theme === "vs" ? "bg-white" : "bg-[#111113]")}>
                {isHealing && (
                    <div className={cn("absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 backdrop-blur-sm", theme === "vs" ? "bg-white/80" : "bg-[#111113]/80")}>
                        <div className="w-10 h-10 rounded-full border-2 border-[#2222E3]/30 border-t-[#2222E3] animate-spin" />
                        <p className={cn("text-sm font-medium", theme === "vs" ? "text-slate-600" : "text-slate-300")}>Generating contextual fix…</p>
                    </div>
                )}
                {showEditor ? (
                    <DiffEditor
                        height="100%"
                        language="html"
                        original={originalHtml}
                        modified={modifiedHtml}
                        theme={theme}
                        options={monacoOptions}
                        onMount={handleEditorMount}
                    />
                ) : (
                    !mounted && <MonacoLoadingPlaceholder />
                )}
            </div>
        </section>
    );
}

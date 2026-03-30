"use client";

import {
    Code2, FileCode, SplitSquareHorizontal,
    Zap, Sparkles, Cpu, CheckCircle2, ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useMemo, memo } from "react";
import type { ScanStatus } from "./UrlInputBar";
import type { HealResponse } from "@/lib/scan-types";
import dynamic from "next/dynamic";

// ── Stable dynamic import — never re-created ──────────────────────────────────
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

// ── Stable Monaco options object (never re-created between renders) ───────────
const MONACO_OPTIONS = {
    readOnly: false,
    renderSideBySide: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 12,
    lineHeight: 20,
    padding: { top: 12, bottom: 12 },
    scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
    diffWordWrap: "on" as const,
    lineNumbers: "on" as const,
    folding: false,
    renderLineHighlight: "none" as const,
};

const IDLE_BEFORE = `<!-- Paste a URL above and click Scan.

     AllyFlow will:
       1. Load the page via Puppeteer
       2. Strip <script> tags and on* handlers (Snapshot Policy)
       3. Run axe-core WCAG 2.1 AA audit
       4. Expand a violation → click "Fix with AI" -->`.trim();

const IDLE_AFTER = `<!-- Fixed HTML will appear here.

     Workflow:
       1. Fix with AI  →  Gemini or JSDOM generates the fix
       2. Apply Fix    →  Patches the fix into your master doc
       3. Download     →  Export allyflow-remediated.html -->`.trim();

interface DiffViewerProps {
    status: ScanStatus;
    beforeCode?: string;
    healResult?: HealResponse | null;
    isHealing?: boolean;
    appliedResults?: Map<string, HealResponse>;
    onApplyFix?: (violationId: string, result: HealResponse) => void;
}

// ── Memoized inner Monaco renderer — only re-renders when content changes ─────
const MemoizedDiffEditor = memo(function MemoizedDiffEditor({
    original,
    modified,
}: {
    original: string;
    modified: string;
}) {
    return (
        <DiffEditor
            height="calc(100vh - 150px)"
            language="html"
            original={original}
            modified={modified}
            theme="vs-dark"
            options={MONACO_OPTIONS}
        />
    );
});

export default function DiffViewer({
    status,
    beforeCode,
    healResult,
    isHealing = false,
    appliedResults = new Map(),
    onApplyFix,
}: DiffViewerProps) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    const hasHealResult = !!healResult;

    const isThisApplied = useMemo(
        () => healResult
            ? [...appliedResults.values()].some((r) => r.original === healResult.original)
            : false,
        [healResult, appliedResults]
    );

    const original = hasHealResult ? healResult!.original : (beforeCode ?? IDLE_BEFORE);
    const modified = hasHealResult ? healResult!.fixed : IDLE_AFTER;
    const showEditor = mounted && (status === "complete" || status === "idle" || hasHealResult);

    function handleApplyClick() {
        if (!healResult || !onApplyFix || isThisApplied) return;
        const violationId = healResult.original.slice(0, 40);
        onApplyFix(violationId, healResult);
    }

    return (
        <section className="flex flex-col h-full bg-[#1e1e1e] rounded-xl overflow-hidden border border-slate-700/50" aria-label="Code diff viewer">
            {/* ── Toolbar ── */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#252526] border-b border-slate-700/50 flex-shrink-0">
                <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                    <SplitSquareHorizontal className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest">
                        Diff View
                    </span>

                    {/* Strategy badge */}
                    {hasHealResult && (
                        <span className={cn(
                            "inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border",
                            healResult!.strategy === "jsdom"
                                ? "bg-blue-500/10 border-blue-500/25 text-blue-400"
                                : "bg-violet-500/10 border-violet-500/25 text-violet-400"
                        )}>
                            {healResult!.strategy === "jsdom"
                                ? <><Cpu className="w-2.5 h-2.5" />JSDOM</>
                                : <><Sparkles className="w-2.5 h-2.5" />Gemini AI</>
                            }
                        </span>
                    )}

                    {/* Applied badge */}
                    {isThisApplied && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border bg-emerald-500/10 border-emerald-500/25 text-emerald-400">
                            <CheckCircle2 className="w-2.5 h-2.5" />Applied
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Pane labels */}
                    <div className="hidden sm:flex items-center gap-3 text-[11px]">
                        <span className="flex items-center gap-1 text-slate-500">
                            <FileCode className="w-3 h-3" />
                            <span className="text-red-400/70">
                                {hasHealResult ? "Broken" : (beforeCode ? "Sanitized HTML" : "Before")}
                            </span>
                        </span>
                        <span className="text-slate-600">→</span>
                        <span className="flex items-center gap-1 text-slate-500">
                            <Code2 className="w-3 h-3" />
                            <span className="text-emerald-400/70">
                                {hasHealResult ? "Fixed" : "After"}
                            </span>
                        </span>
                    </div>

                    {/* Apply Fix button */}
                    {hasHealResult && onApplyFix && (
                        <button
                            id="apply-fix-btn"
                            onClick={handleApplyClick}
                            disabled={isThisApplied}
                            className={cn(
                                "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all duration-150",
                                isThisApplied
                                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400/60 cursor-not-allowed"
                                    : "bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-500 active:scale-95 shadow-sm shadow-emerald-900/50"
                            )}
                        >
                            <ClipboardCheck className="w-3 h-3" />
                            {isThisApplied ? "Applied ✓" : "Apply Fix"}
                        </button>
                    )}
                </div>
            </div>

            {/* Fix description bar */}
            {hasHealResult && healResult!.description && (
                <div className="px-4 py-2 bg-emerald-950/40 border-b border-emerald-900/30 flex-shrink-0">
                    <p className="text-[11px] text-emerald-400/80 flex items-center gap-1.5 truncate">
                        <Zap className="w-3 h-3 flex-shrink-0" />
                        {healResult!.description}
                    </p>
                </div>
            )}

            {/* ── Monaco area ── */}
            <div className="relative flex-1 min-h-0">

                {/* Healing overlay */}
                {isHealing && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#1e1e1e]/90 backdrop-blur-sm">
                        <div className="relative w-10 h-10">
                            <div className="w-10 h-10 rounded-full border-2 border-violet-500/30 border-t-violet-400 animate-spin" />
                            <div className="absolute inset-2 rounded-full border border-blue-500/20 animate-pulse" />
                        </div>
                        <div className="text-center">
                            <p className="text-sm font-medium text-slate-300">Generating fix…</p>
                            <p className="text-xs text-slate-500 mt-0.5">Hybrid Fix Engine running</p>
                        </div>
                    </div>
                )}

                {/* Scan overlay */}
                {status === "scanning" && !isHealing && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center gap-3 bg-[#1e1e1e]/80 backdrop-blur-sm">
                        <div className="w-8 h-8 rounded-full border-2 border-violet-500/30 border-t-violet-400 animate-spin" />
                        <p className="text-sm text-slate-400">Scanning…</p>
                    </div>
                )}

                {showEditor ? (
                    <MemoizedDiffEditor original={original} modified={modified} />
                ) : (
                    !mounted && <MonacoLoadingPlaceholder />
                )}
            </div>
        </section>
    );
}

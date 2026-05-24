"use client";

import { useState, useCallback, memo } from "react";
import {
    ChevronDown, ChevronUp, Wand2, Loader2,
    CheckCircle2, AlertTriangle, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
    BestPracticeViolation,
} from "@/lib/best-practices-types";
import {
    categoryLabel,
    categoryColor,
    categoryIcon,
} from "@/lib/best-practices-types";

// ─── SEVERITY CONFIG ────────────────────────────────────────────────────────
const SEVERITY_CONFIG = {
    serious: {
        icon: AlertTriangle,
        label: "Serious",
        badge: "bg-orange-500/10 text-orange-400 border-orange-500/20",
        text: "text-orange-400",
        border: "border-orange-500/30",
    },
    moderate: {
        icon: Info,
        label: "Moderate",
        badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
        text: "text-yellow-400",
        border: "border-yellow-500/30",
    },
} as const;

// ─── VIOLATION ROW ──────────────────────────────────────────────────────────
interface ViolationRowProps {
    v: BestPracticeViolation;
    resolvedIds: Set<string>;
    healingId: string | null;
    onFix: (violation: BestPracticeViolation, nodeHtml: string, nodeId: string) => void;
}

const ViolationRow = memo(function ViolationRow({ v, resolvedIds, healingId, onFix }: ViolationRowProps) {
    const [expanded, setExpanded] = useState(false);
    const [selectedNodeIdx, setSelectedNodeIdx] = useState(0);

    const cfg = SEVERITY_CONFIG[v.severity];
    const Icon = cfg.icon;
    const selectedNode = v.nodes[selectedNodeIdx];

    const activeNodeId = `bp-${v.id}-${selectedNodeIdx}`;
    const isActiveNodeResolved = resolvedIds.has(activeNodeId);
    const isHealing = healingId === activeNodeId;
    const isFullyResolved = v.nodes.every((_, i) => resolvedIds.has(`bp-${v.id}-${i}`));

    const handleFixClick = useCallback(() => {
        if (selectedNode) onFix(v, selectedNode.html, activeNodeId);
    }, [v, selectedNode, onFix, activeNodeId]);

    return (
        <div className={cn("rounded-lg border bg-slate-800/40 transition-opacity", cfg.border, isFullyResolved && "opacity-50")}>
            <button
                onClick={() => setExpanded((e) => !e)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-slate-700/20 transition-colors rounded-lg"
            >
                <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", cfg.text)} aria-hidden />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn("text-[10px] font-bold uppercase tracking-wider", cfg.text)}>{cfg.label}</span>
                        <span className={cn("text-[10px] rounded px-1.5 py-0.5 border", categoryColor(v.category))}>
                            {categoryIcon(v.category)} {categoryLabel(v.category)}
                        </span>
                        {isFullyResolved && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 rounded-full px-1.5 py-0.5">
                                <CheckCircle2 className="w-2.5 h-2.5" /> All Fixed
                            </span>
                        )}
                    </div>
                    <p className="text-xs font-medium text-slate-300 truncate mt-0.5">{v.title}</p>
                </div>
                <span className="text-[10px] text-slate-500 mr-1.5 flex-shrink-0">{v.nodes.length}×</span>
                {expanded ? <ChevronUp className="w-3 h-3 text-slate-500 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-slate-500 flex-shrink-0" />}
            </button>

            {expanded && (
                <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-700/40 space-y-2.5">
                    <p className="text-[11px] text-slate-400 leading-relaxed">{v.description}</p>
                    <div className="text-[10px] text-slate-500 bg-slate-900/40 rounded px-2 py-1 border border-slate-700/30 font-mono">
                        {v.wcagRef}
                    </div>

                    {v.nodes.length > 1 && (
                        <div className="flex gap-1 flex-wrap">
                            {v.nodes.slice(0, 8).map((_, i) => (
                                <button
                                    key={i}
                                    onClick={() => setSelectedNodeIdx(i)}
                                    className={cn(
                                        "text-[10px] rounded px-2 py-0.5 border transition-colors",
                                        selectedNodeIdx === i
                                            ? "bg-slate-600 border-slate-500 text-slate-200"
                                            : "bg-transparent border-slate-700 text-slate-500 hover:text-slate-300"
                                    )}
                                >
                                    Node {i + 1} {resolvedIds.has(`bp-${v.id}-${i}`) && "✓"}
                                </button>
                            ))}
                        </div>
                    )}

                    {selectedNode && (
                        <div className="rounded-md bg-slate-900/70 border border-slate-700/50 p-2.5">
                            <code className="text-[11px] text-slate-400 break-all leading-relaxed block font-mono">
                                {selectedNode.html}
                            </code>
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-0.5">
                        {isActiveNodeResolved ? (
                            <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                                <CheckCircle2 className="w-3 h-3" /> Fixed ✓
                            </span>
                        ) : (
                            <button
                                onClick={handleFixClick}
                                disabled={isHealing || !selectedNode}
                                className={cn(
                                    "flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-all duration-150",
                                    isHealing
                                        ? "bg-slate-700/50 border-slate-600 text-slate-400 cursor-not-allowed"
                                        : "bg-violet-600/80 border-violet-500/50 text-white hover:bg-violet-500 active:scale-95 shadow-sm"
                                )}
                            >
                                {isHealing ? <><Loader2 className="w-3 h-3 animate-spin" />Healing…</> : <><Wand2 className="w-3 h-3" />Fix with AI</>}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});



interface BestPracticesPanelProps {
    violations: BestPracticeViolation[];
    loading: boolean;
    healingId: string | null;
    resolvedIds: Set<string>;
    onFix: (violation: BestPracticeViolation, nodeHtml: string, nodeId: string) => void;
}

export default function BestPracticesPanel({
    violations,
    loading,
    healingId,
    resolvedIds,
    onFix,
}: BestPracticesPanelProps) {
    // Group violations by category for display
    const grouped = violations.reduce<Record<string, BestPracticeViolation[]>>((acc, v) => {
        if (!acc[v.category]) acc[v.category] = [];
        acc[v.category].push(v);
        return acc;
    }, {});

    const categoryOrder: Array<"motor" | "cognitive" | "screen-reader"> = ["motor", "cognitive", "screen-reader"];
    const totalNodes = violations.reduce((sum, v) => sum + v.nodes.length, 0);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-8 text-center">
                <div className="w-8 h-8 rounded-full border-2 border-violet-500/30 border-t-violet-400 animate-spin" />
                <p className="text-xs text-slate-400">Scanning for best practice issues…</p>
            </div>
        );
    }

    if (violations.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-2 py-8 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                <p className="text-xs text-emerald-400 font-medium">No best practice issues found!</p>
                <p className="text-[11px] text-slate-500 max-w-[220px]">
                    This page follows accessibility best practices for motor, cognitive, and screen reader users.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-1.5 px-3 py-2.5 bg-slate-900/40 border-b border-slate-700/30 flex-shrink-0">
                {categoryOrder.map((cat) => {
                    const count = grouped[cat]?.reduce((s, v) => s + v.nodes.length, 0) ?? 0;
                    return (
                        <div key={cat} className={cn("rounded-md border px-2 py-1.5 text-center", categoryColor(cat))}>
                            <div className="text-base font-bold leading-none">{count}</div>
                            <div className="text-[9px] font-medium opacity-75 mt-0.5 uppercase tracking-wide">
                                {categoryIcon(cat)} {cat}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2.5 space-y-3">
                {categoryOrder.map((cat) => {
                    const catViolations = grouped[cat];
                    if (!catViolations || catViolations.length === 0) return null;
                    return (
                        <div key={cat}>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-sm">{categoryIcon(cat)}</span>
                                <h3 className="text-[11px] font-bold text-slate-300 uppercase tracking-widest">
                                    {categoryLabel(cat)}
                                </h3>
                                <span className="text-[10px] text-slate-500">
                                    ({catViolations.reduce((s, v) => s + v.nodes.length, 0)} issues)
                                </span>
                            </div>
                            <div className="space-y-1.5">
                                {catViolations.map((v) => (
                                    <ViolationRow
                                        key={v.id}
                                        v={v}
                                        resolvedIds={resolvedIds}
                                        healingId={healingId}
                                        onFix={onFix}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}

            </div>
        </div>
    );
}

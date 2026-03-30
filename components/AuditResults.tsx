"use client";

import {
    AlertTriangle, CheckCircle2, Info, XCircle,
    ChevronDown, ChevronUp, ExternalLink, Wand2, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, memo, useCallback } from "react";
import type { ScanStatus } from "./UrlInputBar";
import type { AxeViolation, HealStatus } from "@/lib/scan-types";

type Impact = "critical" | "serious" | "moderate" | "minor";

const IMPACT_CONFIG: Record<Impact, {
    icon: React.ElementType;
    label: string;
    border: string;
    badge: string;
    text: string;
}> = {
    critical: {
        icon: XCircle,
        label: "Critical",
        border: "border-red-500/30",
        badge: "bg-red-500/10 text-red-400 border-red-500/20",
        text: "text-red-400",
    },
    serious: {
        icon: AlertTriangle,
        label: "Serious",
        border: "border-orange-500/30",
        badge: "bg-orange-500/10 text-orange-400 border-orange-500/20",
        text: "text-orange-400",
    },
    moderate: {
        icon: Info,
        label: "Moderate",
        border: "border-yellow-500/30",
        badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
        text: "text-yellow-400",
    },
    minor: {
        icon: CheckCircle2,
        label: "Minor",
        border: "border-blue-500/30",
        badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        text: "text-blue-400",
    },
};

interface ViolationRowProps {
    v: AxeViolation;
    isResolved: boolean;
    isHealing: boolean;
    onFix: (violation: AxeViolation, nodeHtml: string) => Promise<void>;
}

// React.memo prevents re-renders when sibling violation cards expand/collapse
const ViolationRow = memo(function ViolationRow({ v, isResolved, isHealing, onFix }: ViolationRowProps) {
    const [expanded, setExpanded] = useState(false);
    const [selectedNodeIdx, setSelectedNodeIdx] = useState(0);

    const impact = (v.impact ?? "minor") as Impact;
    const cfg = IMPACT_CONFIG[impact];
    const Icon = cfg.icon;
    const selectedNode = v.nodes[selectedNodeIdx];

    const wcagTags = v.tags
        .filter((t) => t.startsWith("wcag") && /\d/.test(t))
        .map((t) => t.replace("wcag", "").toUpperCase())
        .slice(0, 3);

    const handleFixClick = useCallback(() => {
        if (selectedNode) onFix(v, selectedNode.html);
    }, [v, selectedNode, onFix]);

    return (
        <div className={cn(
            "rounded-lg border bg-slate-800/40 transition-opacity",
            cfg.border,
            isResolved && "opacity-50"
        )}>
            {/* Header */}
            <button
                id={`violation-${v.id}`}
                onClick={() => setExpanded((e) => !e)}
                aria-expanded={expanded}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-slate-700/20 transition-colors rounded-lg"
            >
                <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", cfg.text)} aria-hidden />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn("text-[10px] font-bold uppercase tracking-wider", cfg.text)}>
                            {cfg.label}
                        </span>
                        {wcagTags.map((tag) => (
                            <span key={tag} className="text-[10px] text-slate-500 bg-slate-700/50 rounded px-1 py-0.5">
                                {tag}
                            </span>
                        ))}
                        {isResolved && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 rounded-full px-1.5 py-0.5">
                                <CheckCircle2 className="w-2.5 h-2.5" /> Fixed
                            </span>
                        )}
                    </div>
                    <p className="text-xs font-medium text-slate-300 truncate mt-0.5">{v.help}</p>
                </div>
                <span className="text-[10px] text-slate-500 mr-1.5 flex-shrink-0">
                    {v.nodes.length}×
                </span>
                {expanded
                    ? <ChevronUp className="w-3 h-3 text-slate-500 flex-shrink-0" />
                    : <ChevronDown className="w-3 h-3 text-slate-500 flex-shrink-0" />
                }
            </button>

            {/* Expanded body */}
            {expanded && (
                <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-700/40 space-y-2.5">
                    <p className="text-[11px] text-slate-400 leading-relaxed">{v.description}</p>

                    {/* Node tabs */}
                    {v.nodes.length > 1 && (
                        <div className="flex gap-1 flex-wrap">
                            {v.nodes.slice(0, 5).map((_, i) => (
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
                                    Node {i + 1}
                                </button>
                            ))}
                            {v.nodes.length > 5 && (
                                <span className="text-[10px] text-slate-500 self-center">+{v.nodes.length - 5}</span>
                            )}
                        </div>
                    )}

                    {/* Snippet */}
                    {selectedNode && (
                        <div className="rounded-md bg-slate-900/70 border border-slate-700/50 p-2.5">
                            <code className="text-[11px] text-slate-400 break-all leading-relaxed block font-mono">
                                {selectedNode.html}
                            </code>
                            {selectedNode.failureSummary && (
                                <p className="text-[10px] text-slate-500 mt-2 pt-2 border-t border-slate-700/40">
                                    {selectedNode.failureSummary.replace(/^Fix (?:any|all) of the following:\s*/i, "")}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Action row */}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                        <a
                            href={v.helpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
                        >
                            Learn more <ExternalLink className="w-2.5 h-2.5" />
                        </a>

                        {isResolved ? (
                            <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                                <CheckCircle2 className="w-3 h-3" /> Fixed ✓
                            </span>
                        ) : (
                            <button
                                id={`fix-btn-${v.id}`}
                                onClick={handleFixClick}
                                disabled={isHealing || !selectedNode}
                                aria-busy={isHealing}
                                className={cn(
                                    "flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-all duration-150",
                                    isHealing
                                        ? "bg-slate-700/50 border-slate-600 text-slate-400 cursor-not-allowed"
                                        : "bg-violet-600/80 border-violet-500/50 text-white hover:bg-violet-500 active:scale-95 shadow-sm"
                                )}
                            >
                                {isHealing
                                    ? <><Loader2 className="w-3 h-3 animate-spin" />Healing…</>
                                    : <><Wand2 className="w-3 h-3" />Fix with AI</>
                                }
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});

// ─── Main component ────────────────────────────────────────────────────────────

interface AuditResultsProps {
    status: ScanStatus;
    violations?: AxeViolation[];
    healStatus?: HealStatus;
    healingViolationId?: string | null;
    resolvedIds?: Set<string>;
    onFix: (violation: AxeViolation, nodeHtml: string) => Promise<void>;
}

export default function AuditResults({
    status,
    violations = [],
    healStatus = "idle",
    healingViolationId = null,
    resolvedIds = new Set<string>(),
    onFix,
}: AuditResultsProps) {
    const counts = {
        critical: violations.filter((v) => v.impact === "critical").length,
        serious: violations.filter((v) => v.impact === "serious").length,
        moderate: violations.filter((v) => v.impact === "moderate").length,
        minor: violations.filter((v) => v.impact === "minor" || !v.impact).length,
    };
    const resolved = resolvedIds.size;

    return (
        <section className="flex flex-col h-full overflow-hidden" aria-label="Audit results">
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#252526] border-b border-slate-700/50 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest">
                        Violations
                    </span>
                    {status === "complete" && violations.length > 0 && (
                        <span className="text-[10px] bg-slate-700 text-slate-400 rounded-full px-1.5 py-0.5">
                            {violations.length}
                        </span>
                    )}
                    {resolved > 0 && (
                        <span className="text-[10px] bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 rounded-full px-1.5 py-0.5 flex items-center gap-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5" />{resolved} fixed
                        </span>
                    )}
                </div>
                {healStatus === "healing" && (
                    <span className="flex items-center gap-1 text-[11px] text-violet-400 animate-pulse">
                        <Loader2 className="w-3 h-3 animate-spin" />Healing…
                    </span>
                )}
            </div>

            {/* Summary pills */}
            {status === "complete" && violations.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5 px-3 py-2.5 bg-slate-900/40 border-b border-slate-700/30 flex-shrink-0">
                    {(Object.entries(counts) as [Impact, number][]).map(([impact, count]) => {
                        const cfg = IMPACT_CONFIG[impact];
                        return (
                            <div key={impact} className={cn("rounded-md border px-2 py-1.5 text-center", cfg.badge)}>
                                <div className="text-base font-bold leading-none">{count}</div>
                                <div className="text-[9px] font-medium opacity-75 mt-0.5 uppercase tracking-wide">{cfg.label}</div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Scrollable violation list */}
            <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2.5 space-y-1.5">
                {/* Idle */}
                {status === "idle" && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 py-8 text-center">
                        <AlertTriangle className="w-8 h-8 text-slate-600" />
                        <p className="text-xs text-slate-500 max-w-[200px]">
                            Enter a URL and click <strong className="text-slate-400">Scan</strong> to audit for WCAG violations.
                        </p>
                    </div>
                )}

                {/* Scanning */}
                {status === "scanning" && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
                        <div className="relative w-10 h-10">
                            <div className="w-10 h-10 rounded-full border-2 border-blue-500/20 animate-spin border-t-blue-500" />
                            <div className="absolute inset-2 rounded-full border border-violet-500/30 animate-pulse" />
                        </div>
                        <div className="text-center">
                            <p className="text-xs font-medium text-slate-300">Auditing page…</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">axe-core via Puppeteer</p>
                        </div>
                    </div>
                )}

                {/* No violations */}
                {status === "complete" && violations.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
                        <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                        <p className="text-xs text-emerald-400 font-medium">No violations found!</p>
                        <p className="text-[11px] text-slate-500">Passes all WCAG 2.1 AA rules.</p>
                    </div>
                )}

                {/* Violation list */}
                {status === "complete" && violations.length > 0 && violations.map((v) => (
                    <ViolationRow
                        key={v.id}
                        v={v}
                        isResolved={resolvedIds.has(v.id)}
                        isHealing={healingViolationId === v.id}
                        onFix={onFix}
                    />
                ))}

                {/* Error */}
                {status === "error" && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
                        <XCircle className="w-8 h-8 text-red-400" />
                        <p className="text-xs text-slate-400">Scan failed. Check URL and try again.</p>
                    </div>
                )}
            </div>
        </section>
    );
}

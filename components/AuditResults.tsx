"use client";

import {
    AlertTriangle, CheckCircle2, Info, XCircle,
    ChevronDown, ChevronUp, ExternalLink, Wand2, Loader2,
    Search
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, memo, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ScanStatus } from "./UrlInputBar";
import type { AxeViolation, HealStatus, SeoCheck } from "@/lib/scan-types";

type Impact = "critical" | "serious" | "moderate" | "minor";

const IMPACT_CONFIG: Record<Impact, {
    icon: React.ElementType; label: string; border: string; badge: string; text: string;
}> = {
    critical: { icon: XCircle, label: "Critical", border: "border-red-500/30", badge: "bg-red-500/10 text-red-400 border-red-500/20", text: "text-red-400" },
    serious: { icon: AlertTriangle, label: "Serious", border: "border-orange-500/30", badge: "bg-orange-500/10 text-orange-400 border-orange-500/20", text: "text-orange-400" },
    moderate: { icon: Info, label: "Moderate", border: "border-yellow-500/30", badge: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", text: "text-yellow-400" },
    minor: { icon: CheckCircle2, label: "Minor", border: "border-blue-500/30", badge: "bg-blue-500/10 text-blue-400 border-blue-500/20", text: "text-blue-400" },
};

// ─── Accessibility Row ────────────────────────────────────────────────────────
interface ViolationRowProps {
    v: AxeViolation;
    resolvedIds: Set<string>;
    healingViolationId: string | null;
    onFix: (violation: AxeViolation, nodeHtml: string, nodeId: string) => Promise<void>;
}

const ViolationRow = memo(function ViolationRow({ v, resolvedIds, healingViolationId, onFix }: ViolationRowProps) {
    const [expanded, setExpanded] = useState(false);
    const [selectedNodeIdx, setSelectedNodeIdx] = useState(0);

    const impact = (v.impact ?? "minor") as Impact;
    const cfg = IMPACT_CONFIG[impact];
    const Icon = cfg.icon;
    const selectedNode = v.nodes[selectedNodeIdx];

    // ── THE FIX: Separate Node State from Card State ──
    // 1. Check if the SPECIFIC node we are looking at is fixed
    const activeNodeId = `${v.id}-${selectedNodeIdx}`;
    const isActiveNodeResolved = resolvedIds.has(activeNodeId);
    const isHealing = healingViolationId === activeNodeId;

    // 2. Check if EVERY node in this card is fixed
    const isFullyResolved = v.nodes.every((_, i) => resolvedIds.has(`${v.id}-${i}`));

    const wcagTags = v.tags
        .filter((t) => t.startsWith("wcag") && /\d/.test(t))
        .map((t) => t.replace("wcag", "").toUpperCase())
        .slice(0, 3);

    const handleFixClick = useCallback(() => {
        if (selectedNode) onFix(v, selectedNode.html, activeNodeId);
    }, [v, selectedNode, onFix, activeNodeId]);

    return (
        // Only gray out the card if isFullyResolved is true!
        <div className={cn("rounded-lg border bg-slate-800/40 transition-opacity", cfg.border, isFullyResolved && "opacity-50")}>
            <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-slate-700/20 transition-colors rounded-lg">
                <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", cfg.text)} aria-hidden />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn("text-[10px] font-bold uppercase tracking-wider", cfg.text)}>{cfg.label}</span>
                        {wcagTags.map((tag) => <span key={tag} className="text-[10px] text-slate-500 bg-slate-700/50 rounded px-1 py-0.5">{tag}</span>)}
                        {isFullyResolved && <span className="inline-flex items-center gap-0.5 text-[10px] bg-emerald-500/15 border border-emerald-500/20 text-emerald-400 rounded-full px-1.5 py-0.5"><CheckCircle2 className="w-2.5 h-2.5" /> All Fixed</span>}
                    </div>
                    <p className="text-xs font-medium text-slate-300 truncate mt-0.5">{v.help}</p>
                </div>
                <span className="text-[10px] text-slate-500 mr-1.5 flex-shrink-0">{v.nodes.length}×</span>
                {expanded ? <ChevronUp className="w-3 h-3 text-slate-500 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-slate-500 flex-shrink-0" />}
            </button>

            {expanded && (
                <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-700/40 space-y-2.5">
                    <p className="text-[11px] text-slate-400 leading-relaxed">{v.description}</p>
                    {v.nodes.length > 1 && (
                        <div className="flex gap-1 flex-wrap">
                            {v.nodes.slice(0, 5).map((_, i) => (
                                <button
                                    key={i}
                                    onClick={() => setSelectedNodeIdx(i)}
                                    className={cn("text-[10px] rounded px-2 py-0.5 border transition-colors", selectedNodeIdx === i ? "bg-slate-600 border-slate-500 text-slate-200" : "bg-transparent border-slate-700 text-slate-500 hover:text-slate-300")}
                                >
                                    Node {i + 1} {resolvedIds.has(`${v.id}-${i}`) && "✓"}
                                </button>
                            ))}
                        </div>
                    )}
                    {selectedNode && (
                        <div className="rounded-md bg-slate-900/70 border border-slate-700/50 p-2.5">
                            <code className="text-[11px] text-slate-400 break-all leading-relaxed block font-mono">{selectedNode.html}</code>
                        </div>
                    )}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                        <a href={v.helpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">Learn more <ExternalLink className="w-2.5 h-2.5" /></a>

                        {/* Show checkmark only if this specific node is fixed */}
                        {isActiveNodeResolved ? (
                            <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border bg-emerald-500/10 border-emerald-500/20 text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Fixed ✓</span>
                        ) : (
                            <button
                                onClick={handleFixClick}
                                disabled={isHealing || !selectedNode}
                                className={cn("flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-all duration-150", isHealing ? "bg-slate-700/50 border-slate-600 text-slate-400 cursor-not-allowed" : "bg-violet-600/80 border-violet-500/50 text-white hover:bg-violet-500 active:scale-95 shadow-sm")}
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

// ─── SEO Row ────────────────────────────────────────────────────────────
function SeoRow({ check }: { check: SeoCheck }) {
    const isPass = check.status === "pass";
    return (
        <div className={cn("rounded-lg border bg-slate-800/40 p-3.5", isPass ? "border-emerald-500/30" : "border-red-500/30 bg-red-500/5")}>
            <div className="flex items-start gap-3">
                {isPass ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">{check.title}</h4>
                    <p className="text-[11px] text-slate-400 mt-1 mb-2 leading-relaxed">{check.description}</p>
                    <div className="text-[10px] bg-slate-900/80 rounded px-2.5 py-2 font-mono text-slate-300 border border-slate-700/50 break-all">{check.actualValue || "No value found"}</div>
                </div>
            </div>
        </div>
    );
}

// ─── Main component ────────────────────────────────────────────────────────────
interface AuditResultsProps {
    status: ScanStatus;
    violations?: AxeViolation[];
    seoResults?: SeoCheck[];
    healStatus?: HealStatus;
    healingViolationId?: string | null;
    resolvedIds?: Set<string>;
    onFix: (violation: AxeViolation, nodeHtml: string, nodeId: string) => Promise<void>;
}

export default function AuditResults({
    status, violations = [], seoResults = [], healStatus = "idle",
    healingViolationId = null, resolvedIds = new Set<string>(), onFix,
}: AuditResultsProps) {
    const [view, setView] = useState<"a11y" | "seo">("a11y");

    const counts = {
        critical: violations.filter((v) => v.impact === "critical").length,
        serious: violations.filter((v) => v.impact === "serious").length,
        moderate: violations.filter((v) => v.impact === "moderate").length,
        minor: violations.filter((v) => v.impact === "minor" || !v.impact).length,
    };

    return (
        <section className="flex flex-col h-full overflow-hidden" aria-label="Audit results">
            {/* Panel header with View Toggle */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-slate-700/50 flex-shrink-0 min-h-[48px]">
                {status === "complete" ? (
                    <div className="flex bg-slate-900/80 p-1 rounded-lg border border-slate-700/50">
                        <button onClick={() => setView("a11y")} className={cn("flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold rounded-md transition-colors", view === "a11y" ? "bg-slate-700 text-slate-200 shadow-sm" : "text-slate-500 hover:text-slate-300")}>Accessibility<span className="bg-slate-800 text-slate-400 px-1.5 rounded-full text-[9px]">{violations.length}</span></button>
                        <button onClick={() => setView("seo")} className={cn("flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold rounded-md transition-colors", view === "seo" ? "bg-slate-700 text-slate-200 shadow-sm" : "text-slate-500 hover:text-slate-300")}>SEO Health<span className="bg-slate-800 text-slate-400 px-1.5 rounded-full text-[9px]">{seoResults.filter(s => s.status === "fail").length}</span></button>
                    </div>
                ) : <span className="text-xs font-semibold text-slate-300 uppercase tracking-widest">Scan Results</span>}
                {healStatus === "healing" && view === "a11y" && <span className="flex items-center gap-1 text-[11px] text-violet-400 animate-pulse"><Loader2 className="w-3 h-3 animate-spin" />Healing…</span>}
            </div>

            {status === "complete" && view === "a11y" && violations.length > 0 && (
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

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2.5 space-y-1.5">
                {status === "idle" && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 py-8 text-center">
                        <Search className="w-8 h-8 text-slate-600" />
                        <p className="text-xs text-slate-500 max-w-[200px]">Enter a URL and click <strong className="text-slate-400">Scan</strong> to audit for WCAG and SEO issues.</p>
                    </div>
                )}

                {status === "scanning" && (
                    <div className="flex flex-col gap-2 pt-2">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="rounded-lg border border-slate-700/30 bg-slate-800/20 p-3.5 space-y-3">
                                <div className="flex items-center gap-2.5"><Skeleton className="w-3.5 h-3.5 rounded-full bg-slate-700/50 flex-shrink-0" /><Skeleton className="h-4 w-16 bg-slate-700/50" /><Skeleton className="h-3 w-24 bg-slate-700/50" /></div>
                                <Skeleton className="h-3 w-3/4 bg-slate-700/50" />
                            </div>
                        ))}
                    </div>
                )}

                {status === "complete" && view === "a11y" && violations.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 py-8 text-center">
                        <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                        <p className="text-xs text-emerald-400 font-medium">No accessibility violations found!</p>
                    </div>
                )}

                {/* ── NEW: Pass the required node tracking props ── */}
                {status === "complete" && view === "a11y" && violations.length > 0 && violations.map((v) => (
                    <ViolationRow
                        key={v.id}
                        v={v}
                        resolvedIds={resolvedIds}
                        healingViolationId={healingViolationId}
                        onFix={onFix}
                    />
                ))}

                {status === "complete" && view === "seo" && seoResults.length > 0 && seoResults.map((check) => (
                    <SeoRow key={check.id} check={check} />
                ))}

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
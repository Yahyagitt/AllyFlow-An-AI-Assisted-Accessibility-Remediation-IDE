"use client";
import { useDailyScans } from "@/lib/useDailyScans";
import { useState, useCallback, memo } from "react";
import Sidebar from "@/components/Sidebar";
import UrlInputBar, { type ScanStatus } from "@/components/UrlInputBar";
import AuditResults from "@/components/AuditResults";
import DiffViewer from "@/components/DiffViewer";
import { Activity, Globe, Download, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
    AxeViolation, ScanResponse, HealResponse, HealStatus, SeoCheck
} from "@/lib/scan-types";

type TabId = "dashboard" | "audit" | "diff" | "settings";

// ── Memoized stat card to prevent re-renders ───────────────────────────────────
const StatCard = memo(function StatCard({
    label, value, color,
}: { label: string; value: number; color: string }) {
    return (
        <div className="bg-slate-800/60 rounded-lg border border-slate-700/40 px-4 py-3 flex items-center gap-3">
            <div className={cn("text-2xl font-bold tabular-nums", color)}>{value}</div>
            <div className="text-[11px] text-slate-500 leading-tight">{label}</div>
        </div>
    );
});

export default function DashboardPage() {
    const [activeTab, setActiveTab] = useState<TabId>("audit");
    const { scansToday, incrementScans } = useDailyScans();


    // ── Scan state ────────────────────────────────────────────────────────────
    const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
    const [scannedUrl, setScannedUrl] = useState<string | null>(null);
    const [violations, setViolations] = useState<AxeViolation[]>([]);
    const [seoResults, setSeoResults] = useState<SeoCheck[]>([]);
    const [sanitizedHtml, setSanitizedHtml] = useState<string | undefined>(undefined);
    const [scanError, setScanError] = useState<string | null>(null);

    // ── Heal state ────────────────────────────────────────────────────────────
    const [healStatus, setHealStatus] = useState<HealStatus>("idle");
    const [healingViolationId, setHealingViolationId] = useState<string | null>(null);
    const [healResult, setHealResult] = useState<HealResponse | null>(null);
    const [healError, setHealError] = useState<string | null>(null);

    // ── Master document (IDE workflow) ────────────────────────────────────────
    const [masterHtml, setMasterHtml] = useState<string | undefined>(undefined);
    const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
    const [appliedResults, setAppliedResults] = useState<Map<string, HealResponse>>(new Map());

    const appliedFixCount = resolvedIds.size;
    const canDownload = !!masterHtml && appliedFixCount > 0;

    // ── Scoring Algorithm ─────────────────────────────────────────────────────
    const calculateScore = () => {
        if (!scannedUrl) return 0; // If no scan yet, show 0
        if (violations.length === 0) return 100; // Perfect score!

        let deduction = 0;
        violations.forEach(v => {
            if (v.impact === "critical") deduction += 10;
            else if (v.impact === "serious") deduction += 5;
            else if (v.impact === "moderate") deduction += 2;
            else if (v.impact === "minor") deduction += 1;
        });

        return Math.max(0, 100 - deduction); // Prevent negative scores
    };

    const currentScore = calculateScore();

    // ── Scan ──────────────────────────────────────────────────────────────────
    const handleScan = useCallback(async (url: string) => {
        setScanStatus("scanning");
        setScannedUrl(url);
        setViolations([]);
        setSeoResults([]);
        setSanitizedHtml(undefined);
        setScanError(null);
        setHealResult(null);
        setHealStatus("idle");
        setHealingViolationId(null);
        setMasterHtml(undefined);
        setResolvedIds(new Set());
        setAppliedResults(new Map());

        try {
            const res = await fetch("/api/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Unknown error" }));
                throw new Error(err.error ?? `HTTP ${res.status}`);
            }
            const data: ScanResponse = await res.json();
            setViolations(data.violations);
            setSeoResults(data.seoResults || []);
            setSanitizedHtml(data.sanitizedHtml);
            setMasterHtml(data.sanitizedHtml);
            setScanStatus("complete");
            incrementScans();
        } catch (err) {
            setScanError(err instanceof Error ? err.message : "Unknown error");
            setScanStatus("error");
        }
    }, []);

    // ── Fix (Human-in-the-Loop) ───────────────────────────────────────────────
    const handleFix = useCallback(async (violation: AxeViolation, nodeHtml: string) => {
        setHealStatus("healing");
        setHealingViolationId(violation.id);
        setHealResult(null);
        setHealError(null);

        try {
            const res = await fetch("/api/heal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ violation, nodeHtml }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: "Unknown error" }));
                throw new Error(err.error ?? `HTTP ${res.status}`);
            }
            const data: HealResponse = await res.json();
            setHealResult(data);
            setHealStatus("done");
            setActiveTab("diff");
        } catch (err) {
            setHealError(err instanceof Error ? err.message : "Unknown error");
            setHealStatus("error");
        } finally {
            setHealingViolationId(null);
        }
    }, []);

    // ── Apply Fix to master document ──────────────────────────────────────────
    const handleApplyFix = useCallback((violationId: string, result: HealResponse) => {
        setMasterHtml((prev) => {
            if (!prev) return prev;
            return prev.includes(result.original)
                ? prev.replace(result.original, result.fixed)
                : prev;
        });
        setResolvedIds((prev) => new Set([...prev, violationId]));
        setAppliedResults((prev) => new Map([...prev, [violationId, result]]));
    }, []);

    // ── Download master document ──────────────────────────────────────────────
    const handleDownload = useCallback(() => {
        if (!masterHtml) return;
        const blob = new Blob([masterHtml], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "allyflow-remediated.html";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }, [masterHtml]);

    const isHealing = healStatus === "healing";

    return (
        // True IDE root — h-screen overflow-hidden, never scrolls the browser
        <div className="flex h-screen bg-slate-900 text-slate-100">
            {/* ── Sidebar ── */}
            <div className="sticky top-0 h-screen flex-shrink-0">
                <Sidebar activeTab={activeTab} onTabChange={(id) => setActiveTab(id as TabId)} />
            </div>

            {/* ── Main column ── */}
            <div className="flex flex-col flex-1 min-w-0 overflow-y-auto">

                {/* ── Top bar ── */}
                <header className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#323233] border-b border-slate-700/60 flex-shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <Activity className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                        <span className="text-xs font-semibold text-slate-300">AllyFlow</span>

                        {/* URL breadcrumb */}
                        {scannedUrl && (
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 min-w-0">
                                <span className="text-slate-600">/</span>
                                <Globe className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate max-w-[280px]">{scannedUrl}</span>
                            </div>
                        )}

                        {/* Fix count pill */}
                        {appliedFixCount > 0 && (
                            <span className="flex items-center gap-1 text-[10px] bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 rounded-full px-2 py-0.5">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                {appliedFixCount} fix{appliedFixCount !== 1 ? "es" : ""}
                            </span>
                        )}
                    </div>

                    {/* Download button */}
                    <button
                        id="download-healed-btn"
                        onClick={handleDownload}
                        disabled={!canDownload}
                        title={
                            !masterHtml ? "Scan a page first"
                                : appliedFixCount === 0 ? "Apply at least one fix to enable download"
                                    : `Download with ${appliedFixCount} fix${appliedFixCount !== 1 ? "es" : ""} applied`
                        }
                        className={cn(
                            "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all duration-150 flex-shrink-0",
                            canDownload
                                ? "bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-500 active:scale-95 shadow-sm shadow-emerald-900/40"
                                : "bg-slate-800/50 border-slate-700/50 text-slate-500 cursor-not-allowed"
                        )}
                    >
                        <Download className="w-3 h-3" />
                        Download Healed Code
                        {appliedFixCount > 0 && (
                            <span className="bg-white/20 rounded-full px-1.5 text-[10px] font-bold">
                                {appliedFixCount}
                            </span>
                        )}
                    </button>
                </header>

                {/* ── AUDIT VIEW ── URL bar + error banners + results */}
                {activeTab === "audit" && (
                    <>
                        {/* URL input bar */}
                        <div className="px-4 py-3 bg-[#252526] border-b border-slate-700/40 flex-shrink-0">
                            <UrlInputBar status={scanStatus} onScan={handleScan} />
                        </div>

                        <div className="px-4 py-3 border-b border-slate-700/40 bg-slate-800/20 flex-shrink-0">
                            <div className="grid grid-cols-4 gap-4 max-w-5xl mx-auto">
                                <StatCard label="Scans Today" value={scansToday} color="text-blue-400" />
                                <StatCard label="Violations Found" value={violations.length} color="text-red-400" />
                                <StatCard label="A11y Score" value={currentScore} color="text-yellow-400" />
                                <StatCard label="Fixes Applied" value={appliedFixCount} color="text-emerald-400" />
                            </div>
                        </div>

                        {/* Error banners */}
                        {(scanError || healError) && (
                            <div className="flex-shrink-0 px-4 py-2 space-y-1.5">
                                {scanError && scanStatus === "error" && (
                                    <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 text-xs px-3 py-2">
                                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                        <span className="flex-1 truncate"><strong>Scan failed:</strong> {scanError}</span>
                                        <button onClick={() => setScanError(null)} className="hover:text-red-300 transition-colors"><X className="w-3 h-3" /></button>
                                    </div>
                                )}
                                {healError && healStatus === "error" && (
                                    <div role="alert" className="flex items-center gap-2 rounded-lg border border-orange-500/20 bg-orange-500/10 text-orange-400 text-xs px-3 py-2">
                                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                        <span className="flex-1 truncate"><strong>Fix failed:</strong> {healError}</span>
                                        <button onClick={() => setHealError(null)} className="hover:text-orange-300 transition-colors"><X className="w-3 h-3" /></button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Audit Results panel */}
                        <div className="flex-1 min-h-0 overflow-hidden">
                            <AuditResults
                                status={scanStatus}
                                violations={violations}
                                seoResults={seoResults}
                                healStatus={healStatus}
                                healingViolationId={healingViolationId}
                                resolvedIds={resolvedIds}
                                onFix={handleFix}
                            />
                        </div>
                    </>
                )}

                {/* ── DIFF VIEW ── DiffViewer only, full height */}
                {activeTab === "diff" && (
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <DiffViewer
                            status={scanStatus}
                            beforeCode={sanitizedHtml}
                            healResult={healResult}
                            isHealing={isHealing}
                            appliedResults={appliedResults}
                            onApplyFix={handleApplyFix}
                        />
                    </div>
                )}


                {/* ── SETTINGS ── */}
                {activeTab === "settings" && (
                    <div className="flex-1 overflow-y-auto min-h-0 p-5">
                        <div className="max-w-lg mx-auto mt-10 bg-slate-800/40 rounded-xl border border-slate-700/40 p-8 text-center text-sm text-slate-500">
                            Settings panel coming soon.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

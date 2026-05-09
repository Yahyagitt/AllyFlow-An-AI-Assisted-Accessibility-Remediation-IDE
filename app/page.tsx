"use client";

import { useDailyScans } from "@/lib/useDailyScans";
import { useState, useCallback, memo } from "react";
import Sidebar from "@/components/Sidebar";
import UrlInputBar, { type ScanStatus } from "@/components/UrlInputBar";
import AuditResults from "@/components/AuditResults";
import DiffViewer from "@/components/DiffViewer";
import {
    Activity, Globe, Download, CheckCircle2, AlertTriangle,
    X, ArrowRight, ShieldAlert, SearchCheck
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
    AxeViolation, ScanResponse, HealResponse, HealStatus, SeoCheck
} from "@/lib/scan-types";

type TabId = "dashboard" | "audit" | "settings";

// ── Memoized stat card to prevent re-renders ───────────────────────────────────
const StatCard = memo(function StatCard({
    label, value, color, subtitle
}: { label: string; value: number | string; color: string; subtitle: string }) {
    return (
        <div className="bg-slate-800/40 rounded-xl border border-slate-700/50 p-5 flex flex-col items-center justify-center text-center shadow-lg">
            <div className={cn("text-4xl font-black tracking-tight mb-1", color)}>{value}</div>
            <div className="text-sm font-bold text-slate-300">{label}</div>
            <div className="text-[11px] text-slate-500 mt-1">{subtitle}</div>
        </div>
    );
});

export default function DashboardPage() {
    const [activeTab, setActiveTab] = useState<TabId>("dashboard");
    const { scansToday, incrementScans } = useDailyScans();

    const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
    const [scannedUrl, setScannedUrl] = useState<string | null>(null);
    const [violations, setViolations] = useState<AxeViolation[]>([]);
    const [seoResults, setSeoResults] = useState<SeoCheck[]>([]);
    const [scanError, setScanError] = useState<string | null>(null);

    const [healStatus, setHealStatus] = useState<HealStatus>("idle");
    const [healingViolationId, setHealingViolationId] = useState<string | null>(null);
    const [healResult, setHealResult] = useState<HealResponse | null>(null);
    const [healError, setHealError] = useState<string | null>(null);

    const [masterHtml, setMasterHtml] = useState<string | undefined>(undefined);
    const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

    const appliedFixCount = resolvedIds.size;
    const canDownload = !!masterHtml && appliedFixCount > 0;

    const currentScore = (() => {
        if (!scannedUrl) return 0;
        if (violations.length === 0) return 100;
        let deduction = 0;
        violations.forEach(v => {
            if (v.impact === "critical") deduction += 10;
            else if (v.impact === "serious") deduction += 5;
            else if (v.impact === "moderate") deduction += 2;
            else if (v.impact === "minor") deduction += 1;
        });
        return Math.max(0, 100 - deduction);
    })();

    const seoFailures = seoResults.filter(s => s.status === "fail").length;

    const handleScan = useCallback(async (url: string) => {
        setScanStatus("scanning");
        setScannedUrl(url);
        setViolations([]);
        setSeoResults([]);
        setScanError(null);
        setHealResult(null);
        setHealStatus("idle");
        setHealingViolationId(null);
        setMasterHtml(undefined);
        setResolvedIds(new Set());

        try {
            const res = await fetch("/api/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
            });
            if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

            const data: ScanResponse = await res.json();
            setViolations(data.violations);
            setSeoResults(data.seoResults || []);
            setMasterHtml(data.sanitizedHtml);
            setScanStatus("complete");
            incrementScans();
        } catch (err) {
            setScanError(err instanceof Error ? err.message : "Scan failed");
            setScanStatus("error");
        }
    }, [incrementScans]);

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
            if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

            const data: HealResponse = await res.json();
            setHealResult(data);
            setHealStatus("done");
        } catch (err) {
            setHealError(err instanceof Error ? err.message : "Fix failed");
            setHealStatus("error");
            setHealingViolationId(null);
        }
    }, []);

    const handleApplyFix = useCallback((violationId: string, fullNewHtml: string) => {
        setMasterHtml(fullNewHtml);
        setResolvedIds((prev) => new Set([...prev, violationId]));
        setHealResult(null);
        setHealingViolationId(null);
    }, []);

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

    return (
        <div className="flex h-screen bg-[#111113] text-slate-100 overflow-hidden font-sans">
            <Sidebar activeTab={activeTab} onTabChange={(id) => setActiveTab(id as TabId)} />

            <div className="flex flex-col flex-1 min-w-0 h-screen relative">

                {/* Global Error Banner */}
                {scanError && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm px-4 py-2 shadow-2xl backdrop-blur-md">
                        <AlertTriangle className="w-4 h-4" /> <strong>Scan failed:</strong> {scanError}
                        <button onClick={() => setScanError(null)} className="ml-2"><X className="w-4 h-4 hover:text-red-300" /></button>
                    </div>
                )}

                {/* ── VIEW 1: DASHBOARD (REPORTING PHASE) ── */}
                {activeTab === "dashboard" && (
                    <div className="flex-1 overflow-y-auto">
                        <div className="max-w-4xl mx-auto pt-20 px-8 pb-12">

                            {/* Hero Section */}
                            <div className="text-center mb-10 space-y-3">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 mb-2 shadow-[0_0_40px_-10px_rgba(59,130,246,0.3)]">
                                    <SearchCheck className="w-8 h-8" />
                                </div>
                                <h1 className="text-3xl font-bold tracking-tight text-slate-100">Audit a Website</h1>
                                <p className="text-slate-400 text-sm max-w-lg mx-auto">
                                    Run a comprehensive WCAG 2.1 AA accessibility and basic SEO health check. Enter a URL below to generate your report.
                                </p>
                            </div>

                            {/* The Scanner */}
                            <div className="bg-slate-800/40 p-4 rounded-2xl border border-slate-700/50 shadow-2xl backdrop-blur-sm mb-12">
                                <UrlInputBar status={scanStatus} onScan={handleScan} />
                            </div>

                            {/* The Report (Only shows when scan is complete) */}
                            {scanStatus === "complete" && (
                                <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                                    <div className="flex items-center justify-between mb-6">
                                        <h2 className="text-lg font-semibold flex items-center gap-2">
                                            <ShieldAlert className="w-5 h-5 text-violet-400" />
                                            Audit Report Generated
                                        </h2>
                                        <button
                                            onClick={() => setActiveTab("audit")}
                                            className="group flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-all shadow-[0_0_30px_-5px_rgba(124,58,237,0.4)] hover:shadow-[0_0_30px_-5px_rgba(124,58,237,0.6)]"
                                        >
                                            Review & Fix Issues
                                            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                        <StatCard
                                            label="A11y Score"
                                            value={currentScore}
                                            color={currentScore > 80 ? "text-emerald-400" : currentScore > 50 ? "text-yellow-400" : "text-red-400"}
                                            subtitle="Out of 100 points"
                                        />
                                        <StatCard
                                            label="Accessibility Issues"
                                            value={violations.length}
                                            color={violations.length > 0 ? "text-orange-400" : "text-emerald-400"}
                                            subtitle="WCAG 2.1 AA Violations"
                                        />
                                        <StatCard
                                            label="SEO Failures"
                                            value={seoFailures}
                                            color={seoFailures > 0 ? "text-pink-400" : "text-emerald-400"}
                                            subtitle="Missing Tags/Structure"
                                        />
                                        <StatCard
                                            label="Scans Today"
                                            value={scansToday}
                                            color="text-blue-400"
                                            subtitle="Your daily usage"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── VIEW 2: AUDIT STUDIO (THE IDE) ── */}
                {activeTab === "audit" && (
                    <div className="flex flex-col h-full bg-[#1e1e1e] animate-in fade-in duration-300">
                        {/* IDE Header */}
                        <header className="flex items-center justify-between px-4 h-14 bg-[#252526] border-b border-slate-700/60 flex-shrink-0">
                            <div className="flex items-center gap-3">
                                <Activity className="w-4 h-4 text-violet-400" />
                                <span className="text-sm font-semibold text-slate-200">Remediation Studio</span>
                                {scannedUrl && (
                                    <>
                                        <span className="text-slate-600">/</span>
                                        <span className="text-xs text-slate-400 flex items-center gap-1.5 bg-slate-800/50 px-2 py-1 rounded-md border border-slate-700/50">
                                            <Globe className="w-3 h-3" /> {scannedUrl}
                                        </span>
                                    </>
                                )}
                            </div>

                            <div className="flex items-center gap-3">
                                {appliedFixCount > 0 && (
                                    <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg font-medium">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        {appliedFixCount} Fixes Ready
                                    </span>
                                )}
                                <button
                                    onClick={handleDownload}
                                    disabled={!canDownload}
                                    className={cn(
                                        "flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg transition-all",
                                        canDownload
                                            ? "bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/40"
                                            : "bg-slate-800 text-slate-500 cursor-not-allowed"
                                    )}
                                >
                                    <Download className="w-4 h-4" /> Export Document
                                </button>
                            </div>
                        </header>

                        {/* Split Panes */}
                        <div className="flex-1 flex flex-row min-h-0">
                            {/* Left: Violation List */}
                            <div className="w-[450px] flex flex-col min-h-0 border-r border-slate-700/60 bg-[#18181a] shadow-2xl z-10">
                                {healError && (
                                    <div className="p-3 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex gap-2">
                                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                        <span className="flex-1">{healError}</span>
                                        <button onClick={() => setHealError(null)}><X className="w-3 h-3" /></button>
                                    </div>
                                )}
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

                            {/* Right: Monaco Editor */}
                            <div className="flex-1 flex flex-col min-h-0 bg-[#1e1e1e]">
                                <DiffViewer
                                    status={scanStatus}
                                    beforeCode={masterHtml}
                                    healResult={healResult}
                                    activeViolationId={healingViolationId}
                                    isHealing={healStatus === "healing"}
                                    onApplyFix={handleApplyFix}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* ── VIEW 3: SETTINGS ── */}
                {activeTab === "settings" && (
                    <div className="flex-1 p-8">
                        <div className="max-w-2xl mx-auto bg-slate-800/40 rounded-xl border border-slate-700/40 p-8 text-center text-slate-400">
                            Settings coming soon.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
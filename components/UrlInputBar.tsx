"use client";

import { useState } from "react";
import { Search, Loader2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export type ScanStatus = "idle" | "scanning" | "complete" | "error";

interface UrlInputBarProps {
    status: ScanStatus;
    onScan: (url: string) => void;
}

export default function UrlInputBar({ status, onScan }: UrlInputBarProps) {
    const [url, setUrl] = useState("");

    const isScanning = status === "scanning";

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const trimmed = url.trim();
        if (!trimmed || isScanning) return;
        onScan(trimmed);
    }

    const statusConfig = {
        idle: { label: "Ready to scan", dot: "bg-muted-foreground" },
        scanning: { label: "Scanning…", dot: "bg-blue-400 animate-pulse" },
        complete: { label: "Scan complete", dot: "bg-emerald-400" },
        error: { label: "Scan failed", dot: "bg-red-400" },
    };

    const cfg = statusConfig[status];

    return (
        <div className="glass-strong rounded-2xl p-5 glow-blue">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-widest">
                    Accessibility Audit
                </h2>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={cn("w-2 h-2 rounded-full", cfg.dot)} />
                    {cfg.label}
                </span>
            </div>

            <form
                onSubmit={handleSubmit}
                className="flex items-center gap-3"
                role="search"
                aria-label="URL scanner"
            >
                {/* Input */}
                <div className="relative flex-1">
                    <Search
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
                        aria-hidden="true"
                    />
                    <input
                        id="url-input"
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://example.com"
                        disabled={isScanning}
                        aria-label="Website URL to audit"
                        className={cn(
                            "w-full pl-10 pr-4 py-3 rounded-xl text-sm",
                            "bg-white/[0.05] border border-white/10",
                            "text-foreground placeholder:text-muted-foreground",
                            "focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40",
                            "transition-all duration-200",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                    />
                    {/* Scan line overlay when scanning */}
                    {isScanning && (
                        <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                            <div className="scan-overlay" />
                        </div>
                    )}
                </div>

                {/* Scan Button */}
                <button
                    id="scan-button"
                    type="submit"
                    disabled={isScanning || !url.trim()}
                    aria-busy={isScanning}
                    className={cn(
                        "flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold",
                        "transition-all duration-200 select-none",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                        isScanning
                            ? "bg-blue-600/40 text-blue-200 border border-blue-500/30"
                            : "bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:from-blue-500 hover:to-violet-500 shadow-lg shadow-blue-500/20 active:scale-95"
                    )}
                >
                    {isScanning ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            Scanning
                        </>
                    ) : (
                        <>
                            <Zap className="w-4 h-4" aria-hidden="true" />
                            Scan
                        </>
                    )}
                </button>
            </form>
        </div>
    );
}

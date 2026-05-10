"use client";

import { useState, useRef } from "react";
import { Search, Loader2, Zap, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export type ScanStatus = "idle" | "scanning" | "complete" | "error";

interface UrlInputBarProps {
    status: ScanStatus;
    onScan: (url: string, htmlContent?: string) => void; // Updated signature
}

export default function UrlInputBar({ status, onScan }: UrlInputBarProps) {
    const [url, setUrl] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isScanning = status === "scanning";

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const trimmed = url.trim();
        if (!trimmed || isScanning) return;
        onScan(trimmed);
    }

    // ── Handle File Upload ──
    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file || isScanning) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const htmlContent = event.target?.result as string;
            if (htmlContent) {
                onScan("Uploaded File", htmlContent); // Pass the raw HTML to page.tsx
            }
        };
        reader.readAsText(file);

        // Reset the input so they can upload the same file again if needed
        if (fileInputRef.current) fileInputRef.current.value = "";
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

            <form onSubmit={handleSubmit} className="flex items-center gap-3" role="search">
                <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <input
                        id="url-input"
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://example.com"
                        disabled={isScanning}
                        className={cn(
                            "w-full pl-10 pr-4 py-3 rounded-xl text-sm",
                            "bg-white/[0.05] border border-white/10",
                            "text-foreground placeholder:text-muted-foreground",
                            "focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40",
                            "transition-all duration-200 disabled:opacity-50"
                        )}
                    />
                </div>

                {/* Upload Button */}
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isScanning}
                    title="Upload local HTML file"
                    className="flex items-center justify-center p-3 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                    <Upload className="w-5 h-5 text-slate-300" />
                </button>
                <input
                    type="file"
                    accept=".html"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                />

                <button
                    type="submit"
                    disabled={isScanning || !url.trim()}
                    className={cn(
                        "flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all duration-200",
                        isScanning
                            ? "bg-blue-600/40 text-blue-200 border border-blue-500/30"
                            : "bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:from-blue-500 hover:to-violet-500 shadow-lg shadow-blue-500/20 active:scale-95 disabled:opacity-50"
                    )}
                >
                    {isScanning ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning</> : <><Zap className="w-4 h-4" /> Scan</>}
                </button>
            </form>
        </div>
    );
}
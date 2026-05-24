"use client";

import { useEffect, useRef, useState } from "react";
import { X, Globe, FileCode2, Loader2 } from "lucide-react";

// ── absolutizeHtml and stripSentinel are defined in app/page.tsx (module scope).
// PreviewModal receives already-processed html via props — processing happens in
// the useEffect below, not at the call site, so the modal is self-contained.

interface PreviewModalProps {
    html: string;
    scannedUrl: string | null;
    onClose: () => void;
}

// Inline helpers — duplicated from page.tsx module scope so PreviewModal is
// self-contained and importable from any future route without coupling.
// IMPORTANT: if absolutizeHtml logic changes in page.tsx, mirror it here too.
// (A shared lib/absolutize.ts is the correct long-term home — see Predicted Gap 1.)

function stripSentinelLocal(html: string): string {
    return html.replace(/\s*data-af-target="af-[^"]*"/g, "");
}

function absolutizeHtmlLocal(html: string, scannedUrl: string | null): string {
    const pageOrigin = (() => {
        try { return new URL(scannedUrl ?? "").origin; } catch { return ""; }
    })();
    if (!pageOrigin) return html;
    let result = html;

    result = result.replace(
        /(\b(?:src|href|action|poster|data-src|data-href)=["'])(\/(?!\/))/gi,
        (_: string, attr: string) => `${attr}${pageOrigin}/`
    );
    result = result.replace(
        /(\burl\(["']?)(\/(?!\/))/gi,
        (_: string, prefix: string) => `${prefix}${pageOrigin}/`
    );
    result = result.replace(
        /\bsrcset=(["'])([^"']+)\1/gi,
        (_: string, q: string, val: string) => {
            const fixed = val.replace(
                /((?:,\s*)|^)(\/(?!\/))/g,
                (_2: string, prefix: string) => `${prefix}${pageOrigin}/`
            );
            return `srcset=${q}${fixed}${q}`;
        }
    );
    result = result.replace(/<base\b[^>]*>/gi, "");

    const pageBase = (() => {
        try {
            const u = new URL(scannedUrl ?? "");
            const p = u.pathname.endsWith("/")
                ? u.pathname
                : u.pathname.replace(/\/[^/]*$/, "/");
            return u.origin + p;
        } catch { return pageOrigin; }
    })();

    if (pageBase) {
        result = result.replace(
            /(\b(?:src|href|action|poster|data-src|data-href)=["'])(?!https?:\/\/|\/\/|\/|#|mailto:|tel:|data:|javascript:|["'])([^"']+)/gi,
            (_: string, attr: string, rawPath: string) => {
                try { return `${attr}${new URL(rawPath, pageBase).href}`; }
                catch { return `${attr}${rawPath}`; }
            }
        );
        result = result.replace(
            /(\burl\(["']?)(?!https?:\/\/|\/\/|\/|#|data:|["')]|$)([a-zA-Z0-9._~%-][^"')]*)/gi,
            (_: string, prefix: string, rawPath: string) => {
                try { return `${prefix}${new URL(rawPath, pageBase).href}`; }
                catch { return `${prefix}${rawPath}`; }
            }
        );
        result = result.replace(
            /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
            (_: string, open: string, css: string, close: string) => {
                let fixedCss = css.replace(
                    /(\burl\(["']?)(\/(?!\/))/gi,
                    (__: string, pfx: string) => `${pfx}${pageOrigin}/`
                );
                fixedCss = fixedCss.replace(
                    /(\burl\(["']?)(?!https?:\/\/|\/\/|\/|#|data:|["')]|$)([a-zA-Z0-9._~%-][^"')]*)/gi,
                    (__: string, pfx: string, rawPath: string) => {
                        try { return `${pfx}${new URL(rawPath, pageBase).href}`; }
                        catch { return `${pfx}${rawPath}`; }
                    }
                );
                return `${open}${fixedCss}${close}`;
            }
        );
        result = result.replace(
            /\bsrcset=(["'])([^"']+)\1/gi,
            (_: string, q: string, val: string) => {
                const fixedVal = val.replace(
                    /((?:,\s*)|^)(?!https?:\/\/|\/\/|\/|#|\d+[wx]\b)([a-zA-Z0-9._~%-][^\s,]*)/g,
                    (__: string, sep: string, rawPath: string) => {
                        try { return `${sep}${new URL(rawPath, pageBase).href}`; }
                        catch { return `${sep}${rawPath}`; }
                    }
                );
                return `srcset=${q}${fixedVal}${q}`;
            }
        );
    }
    return result;
}

export default function PreviewModal({ html, scannedUrl, onClose }: PreviewModalProps) {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // Build Blob URL on mount. Revoke on unmount to prevent memory leaks.
    //
    // Processing order (mirrors handleDownload pipeline, minus export-only styles):
    //   1. stripSentinelLocal  — remove internal tracking attrs
    //   2. allyflow-script     — restore hibernated <script> tags so JS runs
    //   3. data-af-on*         — restore event handlers (sandbox has allow-scripts)
    //   4. absolutizeHtmlLocal — load images/CSS from scanned origin
    //   5. Blob URL            — no 2MB srcdoc attr limit; any page size works
    //
    // Why allyflow-script matters: browsers render unknown tag content as visible
    // text — without this conversion the preview shows raw JS as body text.
    // Why data-af-on* matters: sandbox="allow-scripts" is present, so onclick etc.
    // must be real on* attributes or click handlers silently do nothing.
    useEffect(() => {
        const processed = absolutizeHtmlLocal(
            stripSentinelLocal(html)
                .replace(/<allyflow-script\b/gi, "<script")
                .replace(/<\/allyflow-script>/gi, "</script>")
                .replace(/\bdata-af-(on[a-z]+)(=)/gi, "$1$2"),
            scannedUrl
        );
        const blob = new Blob([processed], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        return () => {
            URL.revokeObjectURL(url);
        };
    }, [html, scannedUrl]);

    // Escape key closes the modal
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    // Scroll lock — prevent background page scrolling while modal is open
    useEffect(() => {
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = ""; };
    }, []);

    const isUpload = scannedUrl === "Uploaded File" || !scannedUrl;

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
            {/* ── Top banner ── */}
            <div className="bg-[#252526] border-b border-slate-700/60 px-4 h-10 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
                    {isUpload
                        ? <FileCode2 className="w-3.5 h-3.5 flex-shrink-0" />
                        : <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                    }
                    <span className="truncate">
                        {scannedUrl ?? "Uploaded File"}
                    </span>
                    <span className="text-slate-600 flex-shrink-0">·</span>
                    <span className="text-slate-500 flex-shrink-0">
                        Preview — shows all applied fixes
                    </span>
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close preview"
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors flex-shrink-0 ml-4 px-2 py-1 rounded hover:bg-slate-700/50"
                >
                    <X className="w-3.5 h-3.5" />
                    Close
                </button>
            </div>

            {/* ── Preview area ── */}
            <div className="flex-1 relative overflow-hidden">
                {/* Loading spinner — visible while blob URL is being set or iframe loading */}
                {(!blobUrl || !ready) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] z-10">
                        <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
                    </div>
                )}

                {/* iframe — always in DOM once blobUrl is ready, opacity transitions on load.
                    sandbox security note: allow-scripts + allow-same-origin together mean the
                    sandboxed page can technically remove its own sandbox. This is an acceptable
                    trade-off for a local developer tool where the dev is running their own HTML.
                    For a public multi-tenant deployment, host previews on a separate origin. */}
                {blobUrl && (
                    <iframe
                        ref={iframeRef}
                        src={blobUrl}
                        className={`w-full h-full border-0 bg-white transition-opacity duration-200 ${ready ? "opacity-100" : "opacity-0"}`}
                        sandbox="allow-same-origin allow-scripts allow-forms"
                        title="AllyFlow document preview"
                        onLoad={() => {
                            setReady(true);
                            iframeRef.current?.focus();
                        }}
                    />
                )}
            </div>
        </div>
    );
}

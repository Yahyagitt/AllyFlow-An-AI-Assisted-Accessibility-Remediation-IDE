"use client";

import { useDailyScans } from "@/lib/useDailyScans";
import { useState, useCallback, memo, useRef, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import UrlInputBar, { type ScanStatus } from "@/components/UrlInputBar";
import AuditResults from "@/components/AuditResults";
import DiffViewer from "@/components/DiffViewer";
import PreviewModal from "@/components/PreviewModal";
import { toast } from "sonner"; // ── DAY 6: Shadcn Toasts
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Activity, Globe, Download, CheckCircle2, AlertTriangle,
    X, ArrowRight, ShieldAlert, SearchCheck, FileCode2, Eye,
    Type, WrapText, Settings, BarChart3, List, Clock, Zap,
    Sparkles, Bug, Keyboard, Monitor, Lightbulb, History,
    Loader2, Upload, Trash2, Indent, Shield,
    PanelLeftClose, PanelLeftOpen, Sun, Moon
} from "lucide-react";
import { useSettings } from "@/lib/useSettings";
import { cn } from "@/lib/utils";
import type {
    AxeViolation, ScanResponse, HealResponse, HealStatus, SeoCheck
} from "@/lib/scan-types";
import type {
    BestPracticeViolation, BestPracticesHealResponse
} from "@/lib/best-practices-types";

// ── Fuzzy node lookup: finds the CURRENT version of a node in masterHtml
// even if another fix has mutated some of its attributes.
function findCurrentNodeHtml(staleSnapshot: string, html: string): string | null {
    // 1. Exact match — fastest path
    if (html.includes(staleSnapshot)) return staleSnapshot;

    // 2. Extract tag name
    const tagMatch = staleSnapshot.match(/^<([a-z][a-z0-9]*)/i);
    if (!tagMatch) return null;
    const tag = tagMatch[1].toLowerCase();

    // 3. Build fingerprint from first attribute that exists in the snapshot
    const attrPatterns: RegExp[] = [
        /\bid=["']([^"']+)["']/i,
        /\bdata-af-onclick=["']([^"']+)["']/i,
        /\bsrc=["']([^"']+)["']/i,
        /\bhref=["']([^"'#][^"']*?)["']/i,      // excludes fragment-only href="#..."
        /\bname=["']([^"']+)["']/i,
        /\bplaceholder=["']([^"']+)["']/i,
        /\baria-label=["']([^"']+)["']/i,
        /\bclass=["']([^"']+)["']/i,
        /\brole=["']([^"']+)["']/i,
    ];
    let fingerprint: string | null = null;
    for (const pat of attrPatterns) {
        const m = staleSnapshot.match(pat);
        if (m) { fingerprint = m[0]; break; }
    }
    if (!fingerprint) return null;

    // 4. Escape fingerprint for use in regex
    const escaped = fingerprint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // 5. Try block-level match first, then void/self-closing
    const voidTags = new Set(["input", "br", "hr", "img", "link", "meta", "area", "base", "col", "embed", "param", "source", "track", "wbr"]);
    if (voidTags.has(tag)) {
        const re = new RegExp(`<${tag}\\b[^>]*${escaped}[^>]*>`, "i");
        const m = html.match(re);
        return m ? m[0] : null;
    }

    // Try the original tag first, then "button" as the universal semantic conversion target.
    // Handles: div/span/li/p/a → <button> conversions from prior fixes.
    const tagsToTry: string[] = [tag];
    if (["div", "span", "li", "p", "a"].includes(tag)) tagsToTry.push("button");

    for (const t of tagsToTry) {
        const re = new RegExp(`<${t}\\b[^>]*${escaped}[^>]*>[\\s\\S]*?<\\/${t}>`, "i");
        const m = html.match(re);
        if (m) return m[0];
    }
    return null;
}

// ── Sentinel utilities ────────────────────────────────────────────────────────
// A sentinel attribute (data-af-target="af-{uuid}") is injected into a node in
// masterHtml before each heal call. This makes indexOf() in handleApplyFix find
// the EXACT node that was clicked, not the first duplicate occurrence.
// Sentinel IDs always start with "af-" so stripSentinel never touches legitimate
// data-af-target attributes from the scanned website (e.g. data-af-target="hero").

function generateSentinelId(): string {
    return `af-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function injectSentinel(nodeHtml: string, sentinelId: string): string {
    // Inject into opening tag as first new attribute after the tag name.
    return nodeHtml.replace(/^(<[a-z][a-z0-9]*\b)/i, `$1 data-af-target="${sentinelId}"`);
}

function stripSentinel(html: string): string {
    // Only strips AllyFlow-generated sentinels (uuid always starts with "af-").
    // Does NOT touch legitimate data-af-target attributes from scanned websites.
    return html.replace(/\s*data-af-target="af-[^"]*"/g, "");
}

type TabId = "dashboard" | "audit" | "settings";

// ── absolutizeHtml ────────────────────────────────────────────────
// Pure function: converts all server-relative and bare-relative resource paths
// in an HTML string to absolute URLs based on the scanned page's origin.
// Used by both handleDownload and PreviewModal so logic stays in one place.
// Steps mirror the export pipeline exactly — any future change applies to both.
function absolutizeHtml(html: string, scannedUrl: string | null): string {
    const pageOrigin = (() => {
        try { return new URL(scannedUrl ?? "").origin; } catch { return ""; }
    })();

    if (!pageOrigin) return html;

    let result = html;

    // Step 1: Attribute-based server-relative URLs (src="/...", href="/...", etc.)
    // Does NOT match: href="#section", href="//cdn.example.com", href="https://..."
    result = result.replace(
        /(\b(?:src|href|action|poster|data-src|data-href)=["'])(\/(?!\/))/gi,
        (_: string, attr: string) => `${attr}${pageOrigin}/`
    );

    // Step 2: CSS url() values — /-relative
    result = result.replace(
        /(\burl\(["']?)(\/(?!\/))/gi,
        (_: string, prefix: string) => `${prefix}${pageOrigin}/`
    );

    // Step 3: srcset attribute — /-relative entries in comma-separated list
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

    // Step 4: Remove any <base href> tag — now unnecessary, would break fragment links
    result = result.replace(/<base\b[^>]*>/gi, "");

    // Step 5: Bare relative paths — no leading slash, no protocol, no //
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
        // Step 5a: Attribute-based bare relative paths
        result = result.replace(
            /(\b(?:src|href|action|poster|data-src|data-href)=["'])(?!https?:\/\/|\/\/|\/|#|mailto:|tel:|data:|javascript:|["'])([^"']+)/gi,
            (_: string, attr: string, rawPath: string) => {
                try { return `${attr}${new URL(rawPath, pageBase).href}`; }
                catch { return `${attr}${rawPath}`; }
            }
        );

        // Step 5b: url() in inline style= attributes — bare relative paths
        result = result.replace(
            /(\burl\(["']?)(?!https?:\/\/|\/\/|\/|#|data:|["')]|$)([a-zA-Z0-9._~%-][^"')]*)/gi,
            (_: string, prefix: string, rawPath: string) => {
                try { return `${prefix}${new URL(rawPath, pageBase).href}`; }
                catch { return `${prefix}${rawPath}`; }
            }
        );

        // Step 5c: url() inside <style> blocks — both /-relative and bare-relative
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

        // Step 5d: srcset — bare relative entries within comma-separated list
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

function TiltCard({ children, className = "", onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
    const ref = useRef<HTMLDivElement>(null);

    function handleMove(e: React.MouseEvent<HTMLDivElement>) {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        ref.current.style.transform = `perspective(600px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg)`;
    }

    function handleLeave() {
        if (!ref.current) return;
        ref.current.style.transform = "perspective(600px) rotateY(0deg) rotateX(0deg)";
    }

    return (
        <div
            ref={ref}
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
            onClick={onClick}
            className={`group relative overflow-hidden ${className}`}
            style={{ transition: "box-shadow 0.5s cubic-bezier(0.16, 1, 0.3, 1), translate 0.5s cubic-bezier(0.16, 1, 0.3, 1)" }}
        >
            <div className="absolute inset-0 rounded-[inherit] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{
                    padding: "1px",
                    background: "linear-gradient(135deg, rgba(34,34,227,0.4), rgba(59,130,246,0.1), rgba(34,34,227,0.4))",
                    WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                }}
            />
            {children}
        </div>
    );
}

const StatCard = memo(function StatCard({
    label, value, color, subtitle
}: { label: string; value: number | string; color: string; subtitle: string }) {
    return (
        <TiltCard className="bg-white/[0.02] rounded-xl border border-white/[0.06] shadow-lg hover:-translate-y-0.5">
            <div className="p-5 flex flex-col items-center justify-center text-center">
                <div className={cn("text-4xl font-normal tracking-tight mb-1 transition-all duration-300 group-hover:scale-105", color)}>{value}</div>
                <div className="text-sm font-bold text-slate-300">{label}</div>
                <div className="text-[11px] text-slate-500 mt-1">{subtitle}</div>
            </div>
        </TiltCard>
    );
});

export default function DashboardPage() {
    const { fontSize, wordWrap, tabSize, minimap, anonymousUsage, editorTheme, updateFontSize, updateWordWrap, updateTabSize, updateMinimap, updateAnonymousUsage, updateEditorTheme, clearScanData } = useSettings();
    const [activeTab, setActiveTab] = useState<TabId>("dashboard");
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
    const [rawHtmlContent, setRawHtmlContent] = useState<string | undefined>(undefined);
    const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());

    // ── Refix refs: remember last-called violation + nodeHtml for "Regenerate fix" ──
    const lastFixViolationRef = useRef<AxeViolation | BestPracticeViolation | null>(null);
    const lastFixNodeHtmlRef = useRef<string>("");
    const lastFixIsBpRef = useRef<boolean>(false);

    // ── Best Practices state ──
    const [bpViolations, setBpViolations] = useState<BestPracticeViolation[]>([]);
    const [bpLoading, setBpLoading] = useState(false);
    const [bpHealingId, setBpHealingId] = useState<string | null>(null);
    const [bpResolvedIds, setBpResolvedIds] = useState<Set<string>>(new Set());

    const [showPreview, setShowPreview] = useState(false);

    const auditFileInputRef = useRef<HTMLInputElement>(null);

    // ── Scan progress stages ──
    const [scanStage, setScanStage] = useState<string>("");

    // ── Recent scans (sessionStorage) ──
    interface RecentScan {
        url: string;
        timestamp: string;
        violations: number;
        a11yScore: number;
        seoScore: number;
    }
    const [recentScans, setRecentScans] = useState<RecentScan[]>([]);

    useEffect(() => {
        try {
            const stored = sessionStorage.getItem("allyflow-recent-scans");
            if (stored) setRecentScans(JSON.parse(stored));
        } catch { /* ignore */ }
    }, []);

    // ── Scan duration ──
    const scanStartTime = useRef<number>(0);
    const [scanDuration, setScanDuration] = useState<string>("");

    const appliedFixCount = resolvedIds.size + bpResolvedIds.size;
    const canDownload = !!masterHtml && appliedFixCount > 0;

    // ── SCORES ──
    const a11yScore = (() => {
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

    const seoScore = (() => {
        if (!scannedUrl && seoResults.length === 0) return 0;
        if (seoResults.length === 0) return 100;
        const passes = seoResults.filter(s => s.status === "pass").length;
        return Math.round((passes / seoResults.length) * 100);
    })();

    // ── NEW: Accepts htmlContent for File Uploads ──
    const handleScan = useCallback(async (url: string, htmlContent?: string) => {
        scanStartTime.current = Date.now();
        setScanDuration("");
        setScanStatus("scanning");
        setScanStage("Launching browser…");
        setScannedUrl(url);
        setViolations([]);
        setSeoResults([]);
        setScanError(null);
        setHealResult(null);
        setHealStatus("idle");
        setHealingViolationId(null);
        setMasterHtml(undefined);
        setResolvedIds(new Set());
        setBpViolations([]);
        setBpLoading(false);
        setBpHealingId(null);
        setBpResolvedIds(new Set());

        // Toast: Start notification
        toast("Audit Started", { description: htmlContent ? "Analyzing uploaded file..." : `Scanning ${url}...` });

        try {
            setScanStage("Running axe-core audit…");
            const res = await fetch("/api/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url, htmlContent }), // Pass both!
            });
            if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

            const data: ScanResponse = await res.json();
            setViolations(data.violations);
            setSeoResults(data.seoResults || []);
            setMasterHtml(data.sanitizedHtml);
            setRawHtmlContent(data.rawHtml);
            setScanStage("Processing results…");
            setScanStatus("complete");
            incrementScans();

            // ── Save to recent scans ──
            const newScan: RecentScan = {
                url,
                timestamp: new Date().toLocaleString(undefined, { hour12: true }),
                violations: data.violations.length,
                a11yScore: Math.max(0, 100 - data.violations.reduce((d, v) => {
                    if (v.impact === "critical") return d + 10;
                    if (v.impact === "serious") return d + 5;
                    if (v.impact === "moderate") return d + 2;
                    if (v.impact === "minor") return d + 1;
                    return d;
                }, 0)),
                seoScore: data.seoResults?.length
                    ? Math.round((data.seoResults.filter(s => s.status === "pass").length / data.seoResults.length) * 100)
                    : 100,
            };
            setRecentScans(prev => {
                const updated = [newScan, ...prev].slice(0, 5);
                try { sessionStorage.setItem("allyflow-recent-scans", JSON.stringify(updated)); } catch {}
                return updated;
            });

            // Toast: Success
            toast.success("Audit Complete!", {
                description: `Found ${data.violations.length} Ally issues and processed ${data.seoResults?.length || 0} SEO checks.`
            });

            // ── AUTO-TRIGGER BEST PRACTICES SCAN ──
            if (data.sanitizedHtml) {
                setScanStage("Scanning best practices…");
                setBpLoading(true);
                try {
                    const bpRes = await fetch("/api/best-practices", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ html: data.sanitizedHtml, url: url }),
                    });
                    if (bpRes.ok) {
                        const bpData = await bpRes.json();
                        setBpViolations(bpData.violations ?? []);
                    }
                } catch {
                    // Best practices scan is non-critical — silently ignore
                } finally {
                    setBpLoading(false);
                }
            }

            // ── Calculate duration ──
            const elapsed = Date.now() - scanStartTime.current;
            const seconds = (elapsed / 1000).toFixed(1);
            setScanDuration(`${seconds}s`);

        } catch (err) {
            const msg = err instanceof Error ? err.message : "Scan failed";
            setScanError(msg);
            setScanStatus("error");
            setScanStage("");
            toast.error("Audit Failed", { description: msg });
        }
    }, [incrementScans]);

    const handleRescan = useCallback(() => {
        if (!scannedUrl || !masterHtml) return;
        const savedA11y = new Set(resolvedIds);
        const savedBp = new Set(bpResolvedIds);
        handleScan(scannedUrl, masterHtml).then(() => {
            setResolvedIds(prev => new Set([...savedA11y, ...prev]));
            setBpResolvedIds(prev => new Set([...savedBp, ...prev]));
        });
    }, [scannedUrl, masterHtml, handleScan, resolvedIds, bpResolvedIds]);

    // Add nodeId to the signature
    const handleFix = useCallback(async (violation: AxeViolation, nodeHtml: string, nodeId: string) => {
        lastFixViolationRef.current = violation;
        lastFixIsBpRef.current = false;

        setHealStatus("healing");
        setHealingViolationId(nodeId); // Track the specific node
        setHealResult(null);
        setHealError(null);

        // Normalize onclick → data-af-onclick so healResult.original matches
        // the sanitized masterHtml exactly, enabling reliable string replacement.
        // Strip any prior sentinel before normalizing — refix passes a sentinel-tagged snapshot.
        const sanitizedNodeHtml = stripSentinel(nodeHtml.replace(/\b(on[a-z]+)\s*=/gi, "data-af-$1="));

        // ── Fuzzy lookup: find the CURRENT version of this node in masterHtml ──
        // Search in a sentinel-stripped copy so prior sentinels don't interfere with
        // fingerprint matching. A previous BP fix may have mutated the node (e.g.
        // div→button); sending the stale snapshot would cause a no-op diff.
        const currentNodeHtml = findCurrentNodeHtml(sanitizedNodeHtml, stripSentinel(masterHtml ?? ""));
        if (currentNodeHtml === null) {
            // Node is entirely gone — replaced by a previous fix
            setResolvedIds((prev) => new Set([...prev, nodeId]));
            setHealResult(null);           // clear stale diff — don't show wrong node's diff
            setHealStatus("idle");
            setHealingViolationId(null);
            toast.success("Node already replaced by a previous repair — skipped.", {
                icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
            });
            return;
        }
        // ── Sentinel injection ────────────────────────────────────────────────
        // Tag this exact node in masterHtml with a unique attribute so handleApplyFix
        // can indexOf() the right occurrence even when identical HTML exists elsewhere.
        // Uses a replacer function to avoid $ pattern interpretation in the replacement.
        const sentinelId = generateSentinelId();
        const sentinelNode = injectSentinel(currentNodeHtml, sentinelId);
        setMasterHtml(prev => prev
            ? stripSentinel(prev).replace(currentNodeHtml, () => sentinelNode)
            : prev
        );
        // Send the sentinel-tagged node so healResult.original echoes the sentinel back,
        // making indexOf() in handleApplyFix land on exactly the right node.
        const nodeHtmlToHeal = sentinelNode;
        // Store sentinel version so "Regenerate fix" sends the same node, not the stale snapshot.
        lastFixNodeHtmlRef.current = nodeHtmlToHeal;

        // Extract real page context for document-title violations so the heal API
        // can generate a meaningful, site-specific title instead of a generic fallback.
        // Covers: h1 (strips inner tags), meta description (both attribute orders),
        // og:title (Open Graph — used on WordPress, Shopify, Next.js, most SPAs).
        // undefined for all other violation types — JSON.stringify omits undefined keys,
        // so no extra payload is sent for the common case.
        let pageContext: { h1?: string; metaDescription?: string; ogTitle?: string } | undefined;
        if (violation.id === "document-title" && masterHtml) {
            const h1Match = masterHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
            const metaMatch =
                masterHtml.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']+)["']/i) ??
                masterHtml.match(/<meta\s+content=["']([^"']+)["'][^>]*name=["']description["']/i);
            const ogMatch =
                masterHtml.match(/<meta\s+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
                masterHtml.match(/<meta\s+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
            pageContext = {
                h1: h1Match ? h1Match[1].replace(/<[^>]+>/g, "").trim() : undefined,
                metaDescription: metaMatch ? metaMatch[1].trim() : undefined,
                // Strip site-name suffix before sending to Gemini.
                // Covers: "Home | ACME Corp", "About — My Site", "Page – Brand",
                // "Title - Site Name". Spaced hyphen only (not "Step-by-Step").
                ogTitle: ogMatch
                    ? ogMatch[1].trim().replace(/\s*[\|—–]\s*.+$|\s+-\s+.+$/, "").trim()
                    : undefined,
            };
        }

        try {
            const res = await fetch("/api/heal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ violation, nodeHtml: nodeHtmlToHeal, pageContext }),
            });
            if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

            let data: HealResponse = await res.json();

            // ── html-lang special case ────────────────────────────────────
            // The heal route returns a sentinel because puppeteer mutates the
            // <html> tag and literal replacement always fails. We resolve it
            // here using the actual masterHtml so DiffViewer gets a real diff.
            if (data.patchType === "html-tag-regex") {
                const langValue = data.fixed; // e.g. "en"
                setMasterHtml((current) => {
                    if (!current) return current;
                    // Find the actual <html ...> opening tag in masterHtml
                    const htmlTagMatch = current.match(/<html\b[^>]*>/i);
                    if (!htmlTagMatch) return current;
                    const originalTag = htmlTagMatch[0];
                    let fixedTag: string;
                    if (/\blang=/i.test(originalTag)) {
                        // Replace existing (invalid) lang value
                        fixedTag = originalTag.replace(/\blang=["'][^"']*["']/i, `lang="${langValue}"`);
                    } else {
                        // Inject lang= as the first attribute after <html
                        fixedTag = originalTag.replace(/^<html\b/i, `<html lang="${langValue}"`);
                    }
                    // Resolve the sentinel so DiffViewer shows the real diff
                    data = {
                        ...data,
                        original: originalTag,
                        fixed: fixedTag,
                        patchType: undefined,
                    };
                    // Return unchanged — we only needed masterHtml to resolve the tag
                    return current;
                });
                // Give setState a tick to run before we set healResult
                await new Promise((r) => setTimeout(r, 0));
            }

            // Guard: if the heal produced no real change, auto-resolve.
            // Compare sentinel-stripped versions — Gemini commonly strips data-af-target
            // (not a real attribute), so a naive data.original === data.fixed check would
            // miss the no-op case and show a fake "diff" removing only the sentinel.
            if (stripSentinel(data.original) === stripSentinel(data.fixed)) {
                setMasterHtml(prev => prev ? stripSentinel(prev) : prev); // clean up sentinel
                setResolvedIds((prev) => new Set([...prev, nodeId]));
                setHealResult(null);
                setHealStatus("idle");
                setHealingViolationId(null);
                toast.success("Element already meets this requirement — no change needed.", {
                    duration: 3000,
                });
                return;
            }

            // Strip sentinel AND re-normalize event handlers — defence layer 2.
            // Negative lookbehind (?<!data-af-) is REQUIRED: without it, already-correct
            // data-af-onclick= gets double-normalized to data-af-data-af-onclick=,
            // silently corrupting the attribute and breaking developer's event handlers
            // in the downloaded file. This lookbehind is identical to the route-level fix.
            const cleanFixed = stripSentinel(data.fixed)
                .replace(/(?<!data-af-)\b(on[a-z]+)\s*=/gi, "data-af-$1=");
            setHealResult({ ...data, fixed: cleanFixed });
            setHealStatus("done");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Fix failed";
            // Sentinel was injected before the API call — clean it up on failure
            // so masterHtml isn't permanently corrupted with an orphaned sentinel.
            setMasterHtml(prev => prev ? stripSentinel(prev) : prev);
            setHealError(msg);
            setHealStatus("error");
            setHealingViolationId(null);
            toast.error("AI Generation Failed", { description: msg });
        }
    }, [masterHtml]);

    const handleApplyFix = useCallback((nodeId: string, fullNewHtml: string) => {
        // fullNewHtml is the FULL document as shown in the Modified Monaco pane.
        // Use indexOf + slice to replace only the first occurrence of original with fixed,
        // and show an error toast if the node can't be located (e.g. doc changed since heal).
        if (healResult && healResult.original !== healResult.fixed) {
            setMasterHtml((prev) => {
                if (!prev) return fullNewHtml;
                const idx = prev.indexOf(healResult.original);
                if (idx === -1) {
                    // Node was already replaced or wasn't found — nothing to do
                    toast.error("Could not locate the original element in the document. Re-scan to refresh.", {
                        duration: 4000,
                    });
                    return prev;
                }
                const next = (
                    prev.slice(0, idx) +
                    healResult.fixed +
                    prev.slice(idx + healResult.original.length)
                );
                return next;
            });
        } else {
            // Normalize any manually-typed event handlers before committing to
            // masterHtml. Defence layer 3: catches onclick= introduced via the
            // Monaco editor after the AI-generated fix was already normalized.
            // Negative lookbehind (?<!data-af-) prevents double-normalizing
            // already-correct data-af-onclick= → data-af-data-af-onclick=.
            setMasterHtml(
                fullNewHtml.replace(/(?<!data-af-)\b(on[a-z]+)\s*=/gi, "data-af-$1=")
            );
        }

        // Route to correct resolved-set based on pipeline
        if (nodeId === "manual-edit") {
            // Prevent manual edits from causing ghost cards
        } else if (nodeId.startsWith("bp-")) {
            setBpResolvedIds((prev) => new Set([...prev, nodeId]));
            setBpHealingId(null);
        } else {
            setResolvedIds((prev) => new Set([...prev, nodeId]));
        }

        setHealResult(null);
        setHealingViolationId(null);

        toast.success("Fix Applied!", {
            icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
            description: "Document has been updated successfully."
        });
    }, [healResult]);

    // ── BEST PRACTICES FIX HANDLER ──
    // Uses fuzzy node lookup to find the CURRENT version of the node in masterHtml
    // (even if an A11y fix already mutated some of its attributes), sends that
    // current version to the heal API, then sets unified healResult for DiffViewer.
    const handleBpFix = useCallback(async (violation: BestPracticeViolation, nodeHtml: string, nodeId: string) => {
        // Store violation + flag for "Regenerate fix" — nodeHtmlRef updated after fuzzy lookup
        lastFixViolationRef.current = violation;
        lastFixIsBpRef.current = true;

        setBpHealingId(nodeId);
        setHealStatus("healing");
        setHealingViolationId(nodeId);
        setHealResult(null);
        setHealError(null);

        // Strip any prior sentinel before normalizing — refix passes a sentinel-tagged snapshot.
        const sanitizedNodeHtml = stripSentinel(nodeHtml.replace(/\b(on[a-z]+)\s*=/gi, "data-af-$1="));

        // ── Fuzzy lookup: find current version of this node in masterHtml ──
        // Search in a sentinel-stripped copy so prior sentinels don't interfere with
        // fingerprint matching. "node changed by another fix" ≠ "already fixed for THIS issue".
        const currentNodeHtml = findCurrentNodeHtml(sanitizedNodeHtml, stripSentinel(masterHtml ?? ""));
        if (currentNodeHtml === null) {
            // Element is truly gone — entirely replaced by a previous fix
            setBpResolvedIds((prev) => new Set([...prev, nodeId]));
            setBpHealingId(null);
            setHealResult(null);           // clear stale diff — don't show wrong node's diff
            setHealStatus("idle");
            setHealingViolationId(null);
            toast.success("Node already fully replaced by a previous repair — skipped.", {
                icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
            });
            return;
        }
        // ── Sentinel injection ────────────────────────────────────────────────
        // Tag this exact node in masterHtml with a unique attribute so handleApplyFix
        // can indexOf() the right occurrence even when identical HTML exists elsewhere.
        // Uses a replacer function to avoid $ pattern interpretation in the replacement.
        const sentinelId = generateSentinelId();
        const sentinelNode = injectSentinel(currentNodeHtml, sentinelId);
        setMasterHtml(prev => prev
            ? stripSentinel(prev).replace(currentNodeHtml, () => sentinelNode)
            : prev
        );
        // Send the sentinel-tagged node so healResult.original echoes the sentinel back,
        // making indexOf() in handleApplyFix land on exactly the right node.
        const nodeHtmlToHeal = sentinelNode;
        // Store sentinel version so "Regenerate fix" sends the same node, not the stale snapshot.
        lastFixNodeHtmlRef.current = nodeHtmlToHeal;

        try {
            const res = await fetch("/api/best-practices/heal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ violation, nodeHtml: nodeHtmlToHeal }),
            });
            if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

            const data: BestPracticesHealResponse = await res.json();

            // Guard: no-op — compare sentinel-stripped versions.
            // Gemini commonly strips data-af-target (not a real attribute), so naive
            // data.original === data.fixed would miss the no-op and show a fake diff.
            if (stripSentinel(data.original) === stripSentinel(data.fixed)) {
                setMasterHtml(prev => prev ? stripSentinel(prev) : prev); // clean up sentinel
                setBpResolvedIds((prev) => new Set([...prev, nodeId]));
                setBpHealingId(null);
                setHealResult(null);
                setHealStatus("idle");
                setHealingViolationId(null);
                toast.success("Element already meets this requirement — no change needed.", {
                    duration: 3000,
                });
                return;
            }

            // Set unified healResult — strip sentinel AND re-normalize event handlers.
            // Mirrors handleFix: defence layer 2 against onclick surviving into masterHtml.
            // Negative lookbehind (?<!data-af-) prevents double-normalization of already-
            // correct data-af-onclick= attributes — same guard as route-level and handleFix.
            setHealResult({
                original: data.original,
                fixed: stripSentinel(data.fixed).replace(/(?<!data-af-)\b(on[a-z]+)\s*=/gi, "data-af-$1="),
                strategy: data.strategy,
                description: data.description,
            } as HealResponse);
            setHealStatus("done");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Fix failed";
            // Sentinel was injected before the API call — clean it up on failure
            // so masterHtml isn't permanently corrupted with an orphaned sentinel.
            setMasterHtml(prev => prev ? stripSentinel(prev) : prev);
            setHealError(msg);
            setHealStatus("error");
            setHealingViolationId(null);
            setBpHealingId(null);
            toast.error("Best Practice Fix Failed", { description: msg });
        }
    }, [masterHtml]);

    // ── REFIX: re-trigger the last heal API call with the current node version ──
    const handleRefix = useCallback(() => {
        if (!lastFixViolationRef.current || !healingViolationId) return;
        setHealResult(null);
        if (lastFixIsBpRef.current) {
            handleBpFix(
                lastFixViolationRef.current as BestPracticeViolation,
                lastFixNodeHtmlRef.current,
                healingViolationId
            );
        } else {
            handleFix(
                lastFixViolationRef.current as AxeViolation,
                lastFixNodeHtmlRef.current,
                healingViolationId
            );
        }
    }, [healingViolationId, handleFix, handleBpFix]);

    const handleDownload = useCallback(() => {
        if (!masterHtml) return;

        // ── WAKE UP THE JAVASCRIPT ──
        // Convert <allyflow-script> back to <script> and data-af-on* back to on*.
        // Also strip any pending sentinel (fix generated but not yet applied) so the
        // downloaded file is clean and does not contain internal tracking attributes.
        const finalExportHtml = stripSentinel(
            masterHtml
                .replace(/<allyflow-script\b/gi, "<script")
                .replace(/<\/allyflow-script>/gi, "</script>")
                .replace(/\bdata-af-(on[a-z]+)(=)/gi, "$1$2")
        );

        // ── Export: absolutize all server-relative resource URLs ─────────────────
        // Delegated to absolutizeHtml() — shared with PreviewModal.
        // Any future path-handling changes must be made in absolutizeHtml() only.
        let exportHtml = absolutizeHtml(finalExportHtml, scannedUrl);

        // ── Inject fallback focus styles for AllyFlow-added ARIA elements ────────
        const allyflowFallbackStyles = `\n<style id="allyflow-export-styles">
  /* AllyFlow export: fallback visibility for ARIA-enriched elements */
  [role="radio"][tabindex],
  [role="checkbox"][tabindex] {
    display: inline-block;
    min-width: 16px;
    min-height: 16px;
    border: 2px solid #767676;
    border-radius: 50%;
    vertical-align: middle;
    margin-right: 6px;
  }
  [role="radio"][tabindex]:focus,
  [role="checkbox"][tabindex]:focus {
    outline: 3px solid #005fcc !important;
    outline-offset: 2px !important;
  }
  [role="button"][aria-expanded]:focus {
    outline: 3px solid #005fcc !important;
    outline-offset: 2px !important;
  }
</style>`;
        exportHtml = exportHtml.replace("</head>", `${allyflowFallbackStyles}\n</head>`);

        // ── Create the download blob from the hardened exportHtml ────────────────
        const blob = new Blob([exportHtml], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "allyflow-remediated.html";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        toast.success("File Exported!", {
            description: "All resource paths have been absolutized for local viewing."
        });
    }, [masterHtml, scannedUrl]);

    // ── Keyboard shortcut: Ctrl+2 → Audit Studio, Ctrl+1 → Dashboard ──
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (!e.ctrlKey && !e.metaKey) return;
            if (e.key === "2") { e.preventDefault(); setActiveTab("audit"); }
            if (e.key === "1") { e.preventDefault(); setActiveTab("dashboard"); }
            if (e.key === "3") { e.preventDefault(); setActiveTab("settings"); }
        }
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);


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

                {/* ── VIEW 1: DASHBOARD ── */}
                {activeTab === "dashboard" && (
                    <div className="flex-1 overflow-y-auto animate-fade-in-up-smooth">
                        <div className="max-w-4xl mx-auto pt-20 px-8 pb-12">
                            <div className="text-center mb-10 space-y-3">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#2222E3]/10 border border-[#2222E3]/20 text-[#2222E3] mb-2 shadow-[0_0_40px_-10px_rgba(34,34,227,0.3)]">
                                    <SearchCheck className="w-8 h-8" />
                                </div>
                                <h1 className="text-3xl font-normal tracking-tight text-slate-100">Audit a Website</h1>
                                <p className="text-slate-400 text-sm max-w-lg mx-auto">
                                    Run a comprehensive WCAG 2.1 AA accessibility and basic SEO health check. Enter a URL or upload an HTML file.
                                </p>
                            </div>

                            <div className="bg-white/[0.02] p-4 rounded-2xl border border-white/[0.06] shadow-2xl backdrop-blur-sm mb-8">
                                <UrlInputBar status={scanStatus} onScan={handleScan} />
                            </div>

                            {/* ── Scan Progress Stages ── */}
                            {scanStatus === "scanning" && (
                                <TiltCard className="bg-white/[0.02] rounded-xl border border-white/[0.06] mb-8">
                                    <div className="p-6">
                                        <div className="flex items-center gap-3 mb-4">
                                            <Loader2 className="w-5 h-5 text-[#2222E3] animate-spin" />
                                            <span className="text-sm font-normal text-slate-200">Audit in Progress</span>
                                        </div>
                                        <div className="h-1.5 w-full bg-slate-700/50 rounded-full overflow-hidden mb-3">
                                            <div className="h-full w-full bg-gradient-to-r from-[#2222E3] to-[#2222E3] rounded-full animate-pulse" style={{ animationDuration: "1.5s" }} />
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-slate-400">
                                            <span className="inline-block w-2 h-2 rounded-full bg-[#2222E3] animate-pulse" />
                                            {scanStage || "Initializing…"}
                                        </div>
                                    </div>
                                </TiltCard>
                            )}

                            {/* ── EMPTY STATE (no scan yet) ── */}
                            {scanStatus === "idle" && (
                                <div className="space-y-8">
                                    {/* Getting Started */}
                                    <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-8">
                                        <h2 className="text-lg font-normal flex items-center gap-2 mb-6">
                                            <Lightbulb className="w-5 h-5 text-yellow-400" />
                                            Getting Started
                                        </h2>
                                        <div className="grid sm:grid-cols-3 gap-6">
                                            <TiltCard className="text-center bg-white/[0.02] rounded-xl border border-white/[0.06] p-6">
                                                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#2222E3]/10 border border-[#2222E3]/10 transition-all duration-300 group-hover:bg-[#2222E3]/20 group-hover:scale-110">
                                                    <Globe className="w-5 h-5 text-[#2222E3]" />
                                                </div>
                                                <h3 className="text-sm font-normal text-slate-200 mb-1">Enter a URL</h3>
                                                <p className="text-xs text-slate-500">Paste any public URL above to scan for WCAG violations.</p>
                                            </TiltCard>
                                            <TiltCard className="text-center bg-white/[0.02] rounded-xl border border-white/[0.06] p-6">
                                                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#2222E3]/10 border border-[#2222E3]/10 transition-all duration-300 group-hover:bg-[#2222E3]/20 group-hover:scale-110">
                                                    <Upload className="w-5 h-5 text-[#2222E3]" />
                                                </div>
                                                <h3 className="text-sm font-normal text-slate-200 mb-1">Upload a File</h3>
                                                <p className="text-xs text-slate-500">Drag-and-drop an HTML file for offline auditing.</p>
                                            </TiltCard>
                                            <TiltCard className="text-center bg-white/[0.02] rounded-xl border border-white/[0.06] p-6">
                                                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/10 transition-all duration-300 group-hover:bg-emerald-500/20 group-hover:scale-110">
                                                    <Bug className="w-5 h-5 text-emerald-400" />
                                                </div>
                                                <h3 className="text-sm font-normal text-slate-200 mb-1">Try Test Page</h3>
                                                <p className="text-xs text-slate-500">Use <code className="text-[#2222E3] bg-[#2222E3]/10 px-1 rounded">/test.html</code> to see AllyFlow in action.</p>
                                            </TiltCard>
                                        </div>
                                    </div>

                                    {/* Feature Highlights */}
                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <TiltCard className="bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                            <div className="p-5">
                                                <div className="flex items-center gap-3 mb-3">
                                                    <Zap className="w-5 h-5 text-[#2222E3]" />
                                                    <h3 className="text-sm font-normal text-slate-200">AI-Powered Fixes</h3>
                                                </div>
                                                <p className="text-xs text-slate-400 leading-relaxed">Gemini 2.5 Flash drafts WCAG-compliant HTML for every failing node. Review changes in a Monaco diff editor before applying.</p>
                                            </div>
                                        </TiltCard>
                                        <TiltCard className="bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                            <div className="p-5">
                                                <div className="flex items-center gap-3 mb-3">
                                                    <ShieldAlert className="w-5 h-5 text-emerald-400" />
                                                    <h3 className="text-sm font-normal text-slate-200">Safe by Default</h3>
                                                </div>
                                                <p className="text-xs text-slate-400 leading-relaxed">Scripts are hibernated during scanning. No side effects. The offline heuristic engine guarantees fixes even without AI.</p>
                                            </div>
                                        </TiltCard>
                                        <TiltCard className="bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                            <div className="p-5">
                                                <div className="flex items-center gap-3 mb-3">
                                                    <BarChart3 className="w-5 h-5 text-[#2222E3]" />
                                                    <h3 className="text-sm font-normal text-slate-200">SEO + Best Practices</h3>
                                                </div>
                                                <p className="text-xs text-slate-400 leading-relaxed">Lightweight SEO checks and a 7-rule best-practices engine catch what axe-core automation misses.</p>
                                            </div>
                                        </TiltCard>
                                        <TiltCard className="bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                            <div className="p-5">
                                                <div className="flex items-center gap-3 mb-3">
                                                    <Download className="w-5 h-5 text-[#2222E3]" />
                                                    <h3 className="text-sm font-normal text-slate-200">Export Clean HTML</h3>
                                                </div>
                                                <p className="text-xs text-slate-400 leading-relaxed">Export remediated HTML with absolutized paths, restored scripts, and zero tracking attributes.</p>
                                            </div>
                                        </TiltCard>
                                    </div>

                                    {/* Recent Scans */}
                                    {recentScans.length > 0 && (
                                        <div className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-6">
                                            <h2 className="text-sm font-normal flex items-center gap-2 mb-4 text-slate-300">
                                                <History className="w-4 h-4 text-slate-400" />
                                                Recent Scans
                                            </h2>
                                            <div className="space-y-2">
                                                {recentScans.map((scan, i) => (
                                                    <TiltCard key={i} className="bg-white/[0.02] rounded-lg border border-white/[0.06] cursor-pointer" onClick={() => setActiveTab("audit")}>
                                                        <div className="flex items-center justify-between py-2.5 px-3">
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <Globe className="w-4 h-4 text-slate-500 flex-shrink-0" />
                                                                <span className="text-sm text-slate-300 truncate">{scan.url}</span>
                                                            </div>
                                                            <div className="flex items-center gap-4 flex-shrink-0 ml-3">
                                                                <span className="text-xs text-slate-500">{scan.violations} issues</span>
                                                                <span className={cn("text-xs font-bold", scan.a11yScore > 80 ? "text-emerald-400" : scan.a11yScore > 50 ? "text-yellow-400" : "text-red-400")}>
                                                                    {scan.a11yScore}%
                                                                </span>
                                                                <span className="text-[11px] text-slate-600">{scan.timestamp}</span>
                                                            </div>
                                                        </div>
                                                    </TiltCard>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── SCAN COMPLETE ── */}
                            {scanStatus === "complete" && (
                                <div className="animate-fade-in-up">
                                    <div className="flex items-center justify-between mb-6">
                                        <div className="flex items-center gap-3">
                                            <ShieldAlert className="w-5 h-5 text-[#2222E3]" />
                                            <h2 className="text-lg font-normal">Audit Report Generated</h2>
                                            {scanDuration && (
                                                <span className="flex items-center gap-1 text-xs text-slate-500 bg-white/[0.02] px-2.5 py-1 rounded-md border border-white/[0.06]">
                                                    <Clock className="w-3 h-3" />
                                                    {scanDuration}
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => setActiveTab("audit")}
                                            className="group flex items-center gap-2 bg-[#2222E3] hover:bg-[#2222E3]/80 text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-all shadow-[0_0_20px_-8px_rgba(34,34,227,0.3)] hover:shadow-[0_0_20px_-8px_rgba(34,34,227,0.4)]"
                                        >
                                            Review & Fix Issues
                                            <span className="text-[10px] text-[#2222E3] bg-[#2222E3]/30 px-1.5 py-0.5 rounded ml-1">Ctrl+2</span>
                                            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                        </button>
                                    </div>

                                    {/* Score Cards */}
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                                        <StatCard
                                            label="Ally Score"
                                            value={`${a11yScore}%`}
                                            color={a11yScore > 80 ? "text-emerald-400" : a11yScore > 50 ? "text-yellow-400" : "text-red-400"}
                                            subtitle="WCAG 2.1 AA Health"
                                        />
                                        <StatCard
                                            label="SEO Score"
                                            value={`${seoScore}%`}
                                            color={seoScore === 100 ? "text-emerald-400" : seoScore > 50 ? "text-yellow-400" : "text-red-400"}
                                            subtitle="Search Engine Health"
                                        />
                                        <StatCard
                                            label="Accessibility Issues"
                                            value={violations.length}
                                            color={violations.length > 0 ? "text-orange-400" : "text-emerald-400"}
                                            subtitle="Found Violations"
                                        />
                                        <StatCard
                                            label="Scans Today"
                                            value={scansToday}
                                            color="text-[#2222E3]"
                                            subtitle="Your daily usage"
                                        />
                                    </div>

                                    {/* ── Scan Comparison ── */}
                                    {recentScans.length > 1 && (() => {
                                        const prev = recentScans[1];
                                        const curr = recentScans[0];
                                        const diff = curr.a11yScore - prev.a11yScore;
                                        const currTime = curr.timestamp;
                                        const prevTime = prev.timestamp;
                                        return (
                                            <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-6 mb-6">
                                                <h3 className="text-sm font-normal text-slate-200 flex items-center gap-2 mb-5">
                                                    <BarChart3 className="w-4 h-4 text-[#2222E3]" />
                                                    Scan Comparison
                                                </h3>
                                                <div className="grid grid-cols-2 gap-6">
                                                    <TiltCard className={cn("rounded-lg border", diff < 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/[0.06] bg-white/[0.02]")}>
                                                        <div className="p-5">
                                                            <div className="flex items-center justify-between mb-3">
                                                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Latest</span>
                                                                {diff > 0 && <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">Improved</span>}
                                                            </div>
                                                            <div className="text-sm text-slate-300 mb-3 truncate font-medium" title={curr.url}>{curr.url}</div>
                                                            <div className="flex items-center gap-6">
                                                                <div className="flex flex-col items-center">
                                                                    <span className={cn("text-2xl font-normal", curr.a11yScore > 80 ? "text-emerald-400" : curr.a11yScore > 50 ? "text-yellow-400" : "text-red-400")}>{curr.a11yScore}%</span>
                                                                    <span className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wide">Ally</span>
                                                                </div>
                                                                <div className="flex flex-col items-center">
                                                                    <span className={cn("text-2xl font-normal", curr.seoScore === 100 ? "text-emerald-400" : curr.seoScore > 50 ? "text-yellow-400" : "text-red-400")}>{curr.seoScore}%</span>
                                                                    <span className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wide">SEO</span>
                                                                </div>
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-2xl font-normal text-orange-400">{curr.violations}</span>
                                                                    <span className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wide">Issues</span>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-[11px] text-slate-600 mt-3">
                                                                <Clock className="w-3 h-3" />
                                                                {currTime}
                                                            </div>
                                                        </div>
                                                    </TiltCard>
                                                    <TiltCard className={cn("rounded-lg border", diff > 0 ? "border-red-500/30 bg-red-500/5" : "border-white/[0.06] bg-white/[0.02]")}>
                                                        <div className="p-5">
                                                            <div className="flex items-center justify-between mb-3">
                                                                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Previous</span>
                                                                {diff < 0 && <span className="text-[10px] font-semibold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">Declined</span>}
                                                            </div>
                                                            <div className="text-sm text-slate-300 mb-3 truncate font-medium" title={prev.url}>{prev.url}</div>
                                                            <div className="flex items-center gap-6">
                                                                <div className="flex flex-col items-center">
                                                                    <span className={cn("text-2xl font-normal", prev.a11yScore > 80 ? "text-emerald-400" : prev.a11yScore > 50 ? "text-yellow-400" : "text-red-400")}>{prev.a11yScore}%</span>
                                                                    <span className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wide">Ally</span>
                                                                </div>
                                                                <div className="flex flex-col items-center">
                                                                    <span className={cn("text-2xl font-normal", prev.seoScore === 100 ? "text-emerald-400" : prev.seoScore > 50 ? "text-yellow-400" : "text-red-400")}>{prev.seoScore}%</span>
                                                                    <span className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wide">SEO</span>
                                                                </div>
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-2xl font-normal text-orange-400">{prev.violations}</span>
                                                                    <span className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wide">Issues</span>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-[11px] text-slate-600 mt-3">
                                                                <Clock className="w-3 h-3" />
                                                                {prevTime}
                                                            </div>
                                                        </div>
                                                    </TiltCard>
                                                </div>
                                                {diff === 0 ? (
                                                    <div className="text-center text-sm text-slate-500 mt-4">Scores are identical</div>
                                                ) : (
                                                    <div className={cn("text-center text-sm font-medium mt-4", diff > 0 ? "text-emerald-400" : "text-red-400")}>
                                                        {diff > 0 ? "▲" : "▼"} {Math.abs(diff)} pts {diff > 0 ? "better" : "worse"}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* ── Violation Breakdown (Bar Chart) ── */}
                                    {violations.length > 0 && (() => {
                                        const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
                                        violations.forEach(v => { if (v.impact) counts[v.impact]++; });
                                        const total = violations.length;
                                        const segments = [
                                            { key: "critical", label: "Critical", count: counts.critical, color: "#ef4444", barColor: "bg-red-500" },
                                            { key: "serious", label: "Serious", count: counts.serious, color: "#f97316", barColor: "bg-orange-500" },
                                            { key: "moderate", label: "Moderate", count: counts.moderate, color: "#eab308", barColor: "bg-yellow-500" },
                                            { key: "minor", label: "Minor", count: counts.minor, color: "#64748b", barColor: "bg-slate-500" },
                                        ];
                                        const maxCount = Math.max(...segments.map(s => s.count), 1);
                                        return (
                                            <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-5 mb-6">
                                                <h3 className="text-sm font-normal text-slate-200 mb-4 flex items-center gap-2">
                                                    <BarChart3 className="w-4 h-4 text-[#2222E3]" />
                                                    Violation Breakdown
                                                </h3>
                                                <div className="flex items-end gap-3 h-32 mb-3">
                                                    {segments.map(s => (
                                                        <div key={s.key} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                                                            <span className="text-xs font-normal text-slate-300">{s.count}</span>
                                                            <div
                                                                className="w-full rounded-t-md transition-all duration-500"
                                                                style={{
                                                                    height: `${(s.count / maxCount) * 100}%`,
                                                                    backgroundColor: s.color,
                                                                    minHeight: s.count > 0 ? '4px' : '0px',
                                                                }}
                                                            />
                                                            <span className="text-[10px] text-slate-500 text-center">{s.label}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="text-center text-xs text-slate-500">
                                                    {total} total violation{total !== 1 ? 's' : ''}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* ── Best Practices Summary ── */}
                                    {bpViolations.length > 0 && (() => {
                                        const bpCounts: Record<string, number> = {};
                                        bpViolations.forEach(v => { bpCounts[v.category] = (bpCounts[v.category] || 0) + 1; });
                                        const bpCards = [
                                            { key: "motor", label: "Motor", count: bpCounts["motor"] || 0, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
                                            { key: "cognitive", label: "Cognitive", count: bpCounts["cognitive"] || 0, color: "bg-[#2222E3]/10 text-[#2222E3] border-[#2222E3]/20" },
                                            { key: "screen-reader", label: "Screen Reader", count: bpCounts["screen-reader"] || 0, color: "bg-[#2222E3]/10 text-[#2222E3] border-[#2222E3]/20" },
                                        ];
                                        return (
                                            <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-5 mb-6">
                                                <h3 className="text-sm font-normal text-slate-200 mb-4 flex items-center gap-2">
                                                    <Sparkles className="w-4 h-4 text-[#2222E3]" />
                                                    Best Practices Summary
                                                </h3>
                                                <div className="flex flex-wrap gap-3">
                                                    {bpCards.map(card => card.count > 0 && (
                                                        <div key={card.key} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium", card.color)}>
                                                            {card.label}: {card.count}
                                                        </div>
                                                    ))}
                                                    {bpCards.every(c => c.count === 0) && (
                                                        <span className="text-xs text-slate-500">No best-practice violations found.</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* ── Recent Scans (post-scan) ── */}
                                    {recentScans.length > 1 && (
                                        <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-5">
                                            <h2 className="text-sm font-normal flex items-center gap-2 mb-3 text-slate-300">
                                                <History className="w-4 h-4 text-slate-400" />
                                                Previous Scans
                                            </h2>
                                            <div className="space-y-1.5">
                                                {recentScans.slice(1).map((scan, i) => (
                                                    <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] transition-colors cursor-pointer" onClick={() => setActiveTab("audit")}>
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <Globe className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                                                            <span className="text-xs text-slate-300 truncate">{scan.url}</span>
                                                        </div>
                                                        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                                                            <span className="text-[11px] text-slate-500">{scan.violations} issues</span>
                                                            <span className={cn("text-[11px] font-bold", scan.a11yScore > 80 ? "text-emerald-400" : "text-yellow-400")}>{scan.a11yScore}%</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── VIEW 2: AUDIT STUDIO (THE IDE) ── */}
                {activeTab === "audit" && (
                    <div className={cn(
                        "flex flex-col h-full bg-[#111113]",
                        "animate-fade-in-up-smooth"
                    )}>
                        {/* IDE Header */}
                        <header className="flex items-center justify-between px-4 h-14 bg-[#111113] border-b border-white/[0.06] flex-shrink-0">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                                    className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-white/[0.06] text-slate-500 hover:text-slate-300 transition-all"
                                    title={sidebarCollapsed ? "Show violations panel" : "Hide violations panel"}
                                >
                                    {sidebarCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
                                </button>
                                <Activity className="w-4 h-4 text-[#2222E3]" />
                                <span className="text-sm font-normal text-slate-200">Remediation Studio</span>
                                {scannedUrl && (
                                    <>
                                        <span className="text-slate-600">/</span>
                                        <span className="text-xs text-slate-400 flex items-center gap-1.5 bg-white/[0.02] px-2 py-1 rounded-md border border-white/[0.06]">
                                            {scannedUrl === "Uploaded File" ? <FileCode2 className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                                            {scannedUrl}
                                        </span>
                                    </>
                                )}
                                {!scannedUrl && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => auditFileInputRef.current?.click()}
                                            disabled={scanStatus === "scanning"}
                                            className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md bg-slate-800 border border-slate-700/50 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:scale-95 transition-all"
                                            title="Upload local HTML file"
                                        >
                                            <Upload className="w-3 h-3" />
                                            Upload HTML
                                        </button>
                                        <input
                                            type="file"
                                            accept=".html"
                                            ref={auditFileInputRef}
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                const reader = new FileReader();
                                                reader.onload = (ev) => {
                                                    const content = ev.target?.result as string;
                                                    if (content) handleScan("Uploaded File", content);
                                                };
                                                reader.readAsText(file);
                                                if (auditFileInputRef.current) auditFileInputRef.current.value = "";
                                            }}
                                            className="hidden"
                                        />
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
                                    onClick={() => setShowPreview(true)}
                                    disabled={!masterHtml}
                                    className={cn(
                                        "flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg transition-all",
                                        masterHtml
                                            ? "bg-slate-700 text-slate-200 hover:bg-slate-600 border border-slate-600/60"
                                            : "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/40"
                                    )}
                                >
                                    <Eye className="w-4 h-4" /> Preview
                                </button>
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

                        {/* Progress Bar for Loading States */}
                        <div className="h-[2px] w-full bg-transparent overflow-hidden flex-shrink-0">
                            {(scanStatus === "scanning" || healStatus === "healing") && (
                                <Progress value={undefined} className="h-full w-full rounded-none bg-[#2222E3]/10 [&>div]:bg-[#2222E3] animate-pulse" />
                            )}
                        </div>

                        {/* Split Panes */}
                        <div className="flex-1 flex flex-row min-h-0">
                            {/* Left: Violation List */}
                            <div className={cn(
                                "flex flex-col min-h-0 border-r border-white/[0.06] bg-[#111113] shadow-2xl z-10 transition-[width] duration-300 ease-in-out overflow-hidden",
                                sidebarCollapsed ? "w-0 border-r-0" : "w-[450px]"
                            )}>
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
                                    bpViolations={bpViolations}
                                    bpLoading={bpLoading}
                                    bpHealingId={bpHealingId}
                                    bpResolvedIds={bpResolvedIds}
                                    onBpFix={handleBpFix}
                                />
                            </div>

                            {/* Expand handle when collapsed */}
                            {sidebarCollapsed && (
                                <button
                                    onClick={() => setSidebarCollapsed(false)}
                                    className="flex items-center justify-center w-5 h-20 my-auto bg-[#111113] border-r border-white/[0.06] hover:bg-white/[0.04] text-slate-500 hover:text-slate-300 transition-all rounded-r-md cursor-pointer flex-shrink-0"
                                    title="Show violations panel"
                                >
                                    <PanelLeftOpen className="w-3.5 h-3.5" />
                                </button>
                            )}

                            {/* Right: Monaco Editor */}
                            <div className="flex-1 flex flex-col min-h-0 bg-[#111113]">
                                {scanStatus === "scanning" ? (
                                    <div className="flex-1 flex flex-col p-6 gap-4">
                                        <div className="flex items-center gap-3 mb-4">
                                            <Skeleton className="w-4 h-4 rounded bg-slate-700/50" />
                                            <Skeleton className="h-3 w-24 bg-slate-700/50" />
                                        </div>
                                        <Skeleton className="h-8 w-full bg-slate-700/30 rounded-lg" />
                                        <Skeleton className="h-8 w-full bg-slate-700/30 rounded-lg" />
                                        <Skeleton className="h-8 w-3/4 bg-slate-700/30 rounded-lg" />
                                        <Skeleton className="h-8 w-full bg-slate-700/30 rounded-lg" />
                                        <Skeleton className="h-8 w-5/6 bg-slate-700/30 rounded-lg" />
                                        <Skeleton className="h-8 w-4/5 bg-slate-700/30 rounded-lg" />
                                        <Skeleton className="h-8 w-full bg-slate-700/30 rounded-lg" />
                                        <Skeleton className="h-8 w-2/3 bg-slate-700/30 rounded-lg" />
                                    </div>
                                ) : (
                                    <DiffViewer
                                        status={scanStatus}
                                        beforeCode={masterHtml}
                                        healResult={healResult}
                                        activeViolationId={healingViolationId}
                                        isHealing={healStatus === "healing"}
                                        fontSize={fontSize}
                                        wordWrap={wordWrap}
                                        tabSize={tabSize}
                                        minimap={minimap}
                                        theme={editorTheme}
                                        onApplyFix={handleApplyFix}
                                        onRefix={handleRefix}
                                        onRescan={masterHtml && scannedUrl ? handleRescan : undefined}
                                        onToggleTheme={() => updateEditorTheme(editorTheme === "vs-dark" ? "vs" : "vs-dark")}
                                    />
                                )}
                            </div>
                        </div>

                        {/* Preview Modal — rendered inside audit view for correct z-stacking */}
                        {showPreview && masterHtml && (
                            <PreviewModal
                                html={masterHtml}
                                scannedUrl={scannedUrl}
                                onClose={() => setShowPreview(false)}
                            />
                        )}
                    </div>
                )}

                {/* ── VIEW 3: SETTINGS ── */}
                {activeTab === "settings" && (
                    <div className="flex-1 overflow-y-auto animate-fade-in-up-smooth">
                        <div className="max-w-2xl mx-auto pt-20 px-8 pb-12">
                            <div className="text-center mb-10 space-y-3">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/[0.08] text-white mb-2">
                                    <Settings className="w-8 h-8" />
                                </div>
                                <h1 className="text-3xl font-normal tracking-tight text-slate-100">Settings</h1>
                                <p className="text-slate-400 text-sm max-w-lg mx-auto">
                                    Customize your AllyFlow experience.
                                </p>
                            </div>

                            <div className="space-y-6">
                                {/* Font Size */}
                                <TiltCard className="bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                    <div className="p-6">
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-3">
                                                <Type className="w-5 h-5 text-white" />
                                                <h2 className="text-lg font-normal text-slate-200">Monaco Editor Font Size</h2>
                                            </div>
                                            <button
                                                onClick={() => updateFontSize(13)}
                                                className="text-xs text-slate-400 hover:text-white underline transition-colors"
                                            >
                                                Reset default
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <input
                                                type="range"
                                                min={10}
                                                max={24}
                                                step={1}
                                                value={fontSize}
                                                onChange={(e) => updateFontSize(Number(e.target.value))}
                                                className="flex-1 accent-white h-2 rounded-full appearance-none cursor-pointer bg-slate-700"
                                            />
                                            <span className="text-sm font-mono text-slate-300 w-10 text-right">{fontSize}px</span>
                                        </div>
                                        <div className="flex justify-between text-[11px] text-slate-500 mt-1 px-1">
                                            <span>10px</span>
                                            <span>24px</span>
                                        </div>
                                    </div>
                                </TiltCard>

                                {/* Word Wrap */}
                                <TiltCard className="bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                    <div className="p-6">
                                        <div className="flex items-center gap-3 mb-4">
                                            <WrapText className="w-5 h-5 text-white" />
                                            <h2 className="text-lg font-normal text-slate-200">Word Wrap</h2>
                                        </div>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => updateWordWrap("on")}
                                                className={cn(
                                                    "flex-1 px-4 py-3 rounded-lg border text-sm font-medium transition-all",
                                                    wordWrap === "on"
                                                        ? "bg-white/[0.1] text-white border-white/20"
                                                        : "bg-slate-800 text-slate-400 border-slate-700/40 hover:border-slate-600"
                                                )}
                                            >
                                                On
                                            </button>
                                            <button
                                                onClick={() => updateWordWrap("off")}
                                                className={cn(
                                                    "flex-1 px-4 py-3 rounded-lg border text-sm font-medium transition-all",
                                                    wordWrap === "off"
                                                        ? "bg-white/[0.1] text-white border-white/20"
                                                        : "bg-slate-800 text-slate-400 border-slate-700/40 hover:border-slate-600"
                                                )}
                                            >
                                                Off
                                            </button>
                                        </div>
                                    </div>
                                </TiltCard>

                                {/* Tab Size */}
                                <TiltCard className="bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                    <div className="p-6">
                                        <div className="flex items-center gap-3 mb-4">
                                            <Indent className="w-5 h-5 text-white" />
                                            <h2 className="text-lg font-normal text-slate-200">Tab Size</h2>
                                        </div>
                                        <div className="flex gap-3">
                                            {([2, 4, 8] as const).map((size) => (
                                                <button
                                                    key={size}
                                                    onClick={() => updateTabSize(size)}
                                                    className={cn(
                                                        "flex-1 px-4 py-3 rounded-lg border text-sm font-medium transition-all",
                                                        tabSize === size
                                                            ? "bg-white/[0.1] text-white border-white/20"
                                                            : "bg-slate-800 text-slate-400 border-slate-700/40 hover:border-slate-600"
                                                    )}
                                                >
                                                    {size}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </TiltCard>

                                {/* Minimap */}
                                <TiltCard className="bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                    <div className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <Eye className="w-5 h-5 text-white" />
                                                <h2 className="text-lg font-normal text-slate-200">Minimap</h2>
                                            </div>
                                            <button
                                                onClick={() => updateMinimap(!minimap)}
                                                className={cn(
                                                    "relative w-11 h-6 rounded-full transition-colors",
                                                    minimap ? "bg-white/[0.2]" : "bg-slate-700"
                                                )}
                                            >
                                                <span
                                                    className={cn(
                                                        "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform",
                                                        minimap && "translate-x-5"
                                                    )}
                                                />
                                            </button>
                                        </div>
                                    </div>
                                </TiltCard>

                                {/* Clear All Scan Data */}
                                <TiltCard className="bg-white/[0.02] rounded-xl border border-red-500/10">
                                    <div className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <Trash2 className="w-5 h-5 text-red-400" />
                                                <div>
                                                    <h2 className="text-lg font-normal text-slate-200">Clear All Scan Data</h2>
                                                    <p className="text-xs text-slate-500 mt-0.5">Removes recent scans, daily counters, and cached results</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={clearScanData}
                                                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                                            >
                                                Clear
                                            </button>
                                        </div>
                                    </div>
                                </TiltCard>

                                {/* Anonymous Usage Stats */}
                                <TiltCard className="bg-white/[0.02] rounded-xl border border-white/[0.06]">
                                    <div className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <Shield className="w-5 h-5 text-white" />
                                                <div>
                                                    <h2 className="text-lg font-normal text-slate-200">Anonymous Usage Stats</h2>
                                                    <p className="text-xs text-slate-500 mt-0.5">Help improve AllyFlow by sending anonymous usage data</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => updateAnonymousUsage(!anonymousUsage)}
                                                className={cn(
                                                    "relative w-11 h-6 rounded-full transition-colors",
                                                    anonymousUsage ? "bg-white/[0.2]" : "bg-slate-700"
                                                )}
                                            >
                                                <span
                                                    className={cn(
                                                        "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform",
                                                        anonymousUsage && "translate-x-5"
                                                    )}
                                                />
                                            </button>
                                        </div>
                                    </div>
                                </TiltCard>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
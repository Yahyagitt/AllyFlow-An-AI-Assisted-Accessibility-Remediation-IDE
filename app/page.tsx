"use client";

import { useDailyScans } from "@/lib/useDailyScans";
import { useState, useCallback, memo, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import UrlInputBar, { type ScanStatus } from "@/components/UrlInputBar";
import AuditResults from "@/components/AuditResults";
import DiffViewer from "@/components/DiffViewer";
import PreviewModal from "@/components/PreviewModal";
import { toast } from "sonner"; // ── DAY 6: Shadcn Toasts
import { Progress } from "@/components/ui/progress"; // ── DAY 6: Shadcn Progress
import {
    Activity, Globe, Download, CheckCircle2, AlertTriangle,
    X, ArrowRight, ShieldAlert, SearchCheck, FileCode2, Eye
} from "lucide-react";
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
        setBpViolations([]);
        setBpLoading(false);
        setBpHealingId(null);
        setBpResolvedIds(new Set());

        // Toast: Start notification
        toast("Audit Started", { description: htmlContent ? "Analyzing uploaded file..." : `Scanning ${url}...` });

        try {
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
            setRawHtmlContent(data.rawHtml); // NEW: Save the raw HTML
            setScanStatus("complete");
            incrementScans();

            // Toast: Success
            toast.success("Audit Complete!", {
                description: `Found ${data.violations.length} A11y issues and processed ${data.seoResults?.length || 0} SEO checks.`
            });

            // ── AUTO-TRIGGER BEST PRACTICES SCAN ──
            if (data.sanitizedHtml) {
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

        } catch (err) {
            const msg = err instanceof Error ? err.message : "Scan failed";
            setScanError(msg);
            setScanStatus("error");
            toast.error("Audit Failed", { description: msg });
        }
    }, [incrementScans]);

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
                return (
                    prev.slice(0, idx) +
                    healResult.fixed +
                    prev.slice(idx + healResult.original.length)
                );
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
                            <div className="text-center mb-10 space-y-3">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 mb-2 shadow-[0_0_40px_-10px_rgba(59,130,246,0.3)]">
                                    <SearchCheck className="w-8 h-8" />
                                </div>
                                <h1 className="text-3xl font-bold tracking-tight text-slate-100">Audit a Website</h1>
                                <p className="text-slate-400 text-sm max-w-lg mx-auto">
                                    Run a comprehensive WCAG 2.1 AA accessibility and basic SEO health check. Enter a URL or upload an HTML file.
                                </p>
                            </div>

                            <div className="bg-slate-800/40 p-4 rounded-2xl border border-slate-700/50 shadow-2xl backdrop-blur-sm mb-12">
                                <UrlInputBar status={scanStatus} onScan={handleScan} />
                            </div>

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
                                            {scannedUrl === "Uploaded File" ? <FileCode2 className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                                            {scannedUrl}
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
                                <Progress value={undefined} className="h-full w-full rounded-none bg-blue-500/10 [&>div]:bg-blue-500 animate-pulse" />
                            )}
                        </div>

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
                                    bpViolations={bpViolations}
                                    bpLoading={bpLoading}
                                    bpHealingId={bpHealingId}
                                    bpResolvedIds={bpResolvedIds}
                                    onBpFix={handleBpFix}
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
                                    onRefix={handleRefix}
                                />
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
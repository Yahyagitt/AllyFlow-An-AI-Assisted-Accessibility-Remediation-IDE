import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";
import { readFileSync } from "fs";
import { createRequire } from "module";
import type { AxeViolation, ScanResponse, SeoCheck } from "@/lib/scan-types";

export type { AxeViolation, ScanResponse, SeoCheck } from "@/lib/scan-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Snapshot Policy (The Hibernation Method):
 * We don't delete scripts. We rename them so the browser doesn't execute them,
 * but they stay in the exact correct position in the DOM for the final download.
 */
function sanitizeHtml(rawHtml: string): string {
    // P17: Idempotency guard — if already sanitized (allyflow-script present), skip.
    // handleRescan passes masterHtml (already sanitized) back through the scan pipeline.
    // Without this guard, double-sanitization produces <allyflow-allyflow-script> tags.
    if (rawHtml.includes("<allyflow-script")) return rawHtml;
    return rawHtml
        // 1. Put script tags to sleep (rename to <allyflow-script>)
        .replace(/<script\b/gi, "<allyflow-script")
        .replace(/<\/script>/gi, "</allyflow-script>")
        // 2. Put inline events to sleep (onclick -> data-af-onclick)
        .replace(/\b(on[a-z]+)\s*=\s*/gi, "data-af-$1=");
}

// ── Synthetic violation injector: catches patterns axe misses ────────────────
function injectSyntheticViolations(
    sanitizedHtml: string,
    existingViolations: AxeViolation[]
): AxeViolation[] {
    const synthetic: AxeViolation[] = [];
    const existingIds = new Set(existingViolations.map(v => v.id));

    const makeViolation = (
        id: string, impact: string, help: string,
        description: string, nodes: { html: string; target: string[] }[]
    ): AxeViolation => ({
        id, impact: impact as AxeViolation["impact"], help, description,
        helpUrl: `https://dequeuniversity.com/rules/axe/4.7/${id}`,
        tags: ["wcag2a", "wcag2aa"],
        nodes: nodes.map(n => ({ html: n.html, failureSummary: description, target: n.target }))
    });

    // SYNTHETIC 1: image-alt-filename
    // P18: Merge-mode — if axe already flagged image-alt-filename, ADD our synthetic nodes
    // to the existing violation instead of skipping. This ensures all bad-alt images are
    // covered even when axe only catches a subset.
    {
        const existingViolation = existingViolations.find(v => v.id === "image-alt-filename");
        const imgRegex = /<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi;
        const nodes: { html: string; target: string[] }[] = [];
        let m: RegExpExecArray | null;
        while ((m = imgRegex.exec(sanitizedHtml)) !== null) {
            const altVal = m[1];
            const isFilePath = /^\//.test(altVal) ||
                /\.(svg|png|jpg|jpeg|gif|webp|ico|bmp)$/i.test(altVal) ||
                /^https?:\/\//.test(altVal) ||
                /^data:/.test(altVal) ||
                ["image", "photo", "picture", "graphic", "icon", "logo", "img", "thumbnail"]
                    .includes(altVal.toLowerCase().trim()) ||
                altVal.trim().length === 1;
            if (isFilePath) nodes.push({ html: m[0], target: ["img"] });
        }

        // P11 empty-alt pass (merged here for single-pass efficiency — Bug 5 fix).
        // axe passes alt="" as "intentionally decorative" — but many real pages use alt=""
        // on product/hero images carelessly. We flag these so the heal route can apply
        // deriveAltFromFilename or pageContext fallback.
        // Guard: skip genuinely decorative patterns (spacer, pixel, divider, icon, etc.)
        const emptyAltImgRegex2 = /<img\b[^>]*\balt=["']["'][^>]*>/gi;
        let emm2: RegExpExecArray | null;
        while ((emm2 = emptyAltImgRegex2.exec(sanitizedHtml)) !== null) {
            const imgTag = emm2[0];
            const srcVal = (imgTag.match(/\bsrc=["']([^"']+)["']/i) ?? [])[1] ?? "";
            if (!srcVal) continue;
            const isDecorativeSrc = /\b(spacer|pixel|blank|transparent|1x1|divider|separator|dot|border|bg|background|texture|noise|grain|shadow|gradient|overlay|mask|logo|icon)\b/i.test(srcVal);
            if (isDecorativeSrc) continue;
            if (/^data:|^blob:/i.test(srcVal)) continue;
            const hasReadablePath = /\/[a-zA-Z][a-zA-Z0-9_-]{2,}\.[a-z]{2,5}(\?|$)/i.test(srcVal) ||
                /https?:\/\/[^/]+\//.test(srcVal);
            if (!hasReadablePath) continue;
            if (nodes.some(n => n.html === imgTag)) continue;
            nodes.push({ html: imgTag, target: ["img[alt='']"] });
        }

        if (nodes.length > 0) {
            if (existingViolation) {
                // Merge: add synthetic nodes not already in the axe violation
                const existingHtmls = new Set(existingViolation.nodes.map(n => n.html));
                for (const node of nodes) {
                    if (!existingHtmls.has(node.html)) {
                        existingViolation.nodes.push({
                            html: node.html,
                            failureSummary: "Alt text is a filename, URL, or generic term",
                            target: node.target,
                        });
                    }
                }
            } else {
                synthetic.push(makeViolation(
                    "image-alt-filename", "serious",
                    "Image alt text is a file path or generic word, not a description",
                    "Alt text that is a filename, URL, or generic term like 'image' does not convey meaning to screen reader users.",
                    nodes
                ));
            }
        }
    }

    // SYNTHETIC 2: keyboard-unreachable (naturally focusable + tabindex="-1")
    if (!existingIds.has("keyboard-unreachable")) {
        const tabNegRegex = /<(?:a|button)\b[^>]*\btabindex=["']-1["'][^>]*(?:href=["'][^"']*["'][^>]*)?>/gi;
        const nodes: { html: string; target: string[] }[] = [];
        let m: RegExpExecArray | null;
        while ((m = tabNegRegex.exec(sanitizedHtml)) !== null) {
            if (/\bhref=["'][^"']+["']/i.test(m[0]) || /^<button/i.test(m[0]))
                nodes.push({ html: m[0], target: ["a[tabindex='-1']"] });
        }
        if (nodes.length > 0) synthetic.push(makeViolation(
            "keyboard-unreachable", "serious",
            "Focusable element removed from keyboard tab order",
            "tabindex='-1' on a naturally focusable element makes it unreachable by keyboard navigation.",
            nodes
        ));
    }

    // SYNTHETIC 3: aria-role-application-misuse
    if (!existingIds.has("aria-role-application-misuse")) {
        const roleAppRegex = /<(?:div|span|section|p|li|article)\b[^>]*\brole=["']application["'][^>]*>/gi;
        const nodes: { html: string; target: string[] }[] = [];
        let m: RegExpExecArray | null;
        while ((m = roleAppRegex.exec(sanitizedHtml)) !== null) {
            nodes.push({ html: m[0], target: ["[role=application]"] });
        }
        if (nodes.length > 0) {
            // Batch all nodes into ONE violation to avoid duplicate-id React key crashes.
            // Use the more informative duplicate-role message if any node has two role= attrs.
            const anyHasDuplicateRole = nodes.some(
                node => (node.html.match(/\brole=/gi) ?? []).length > 1
            );
            synthetic.push(makeViolation(
                "aria-role-application-misuse", "serious",
                anyHasDuplicateRole
                    ? "role='application' and a second role= attribute detected on the same element. Remove role='application' and the duplicate — keep only the correct single role."
                    : "role='application' should only be used on true widget containers (e.g. a drawing canvas), never on generic div/span elements.",
                "role='application' instructs AT to disable standard reading commands. Using it on generic elements breaks screen reader navigation.",
                nodes
            ));
        }
    }

    // SYNTHETIC 4: aria-pressed-static — aria-pressed="true" on non-toggle buttons
    // v22: Reverted v21 rawHtml reverse-normalization (was wrong direction — masterHtml is always
    // sanitized/data-af-onclick form; storing onclick form caused guaranteed fingerprint mismatch).
    // v22: Full-element capture instead of opening-tag-only. Opening tag was too fragile —
    // prior fixes applied in the same session could shift surrounding structure, invalidating
    // the exact opening-tag string. Full element is more unique and survives adjacent changes.
    // Targets <button> only — div/span/a variants are converted to <button> by prior fake-btn fixes
    // and no longer exist in masterHtml in their original div/span/a form.
    if (!existingIds.has("aria-pressed-static")) {
        const nodes: { html: string; target: string[] }[] = [];
        // Full-element capture: match opening tag, walk to closing </button> using depth counter.
        const pressedOpenRegex = /<button\b[^>]*\baria-pressed=["']true["'][^>]*>/gi;
        let m: RegExpExecArray | null;
        while ((m = pressedOpenRegex.exec(sanitizedHtml)) !== null) {
            const openTag = m[0];
            const isToggle = /\b(aria-expanded|aria-controls)\s*=/i.test(openTag) ||
                /\b(toggle|switch|expand|collapse|mute)\b/i.test(openTag);
            if (isToggle) continue;
            // Walk forward from end of opening tag to find matching </button>
            let depth = 1;
            let pos = m.index + openTag.length;
            const closeRe = /<button\b[^>]*>|<\/button>/gi;
            closeRe.lastIndex = pos;
            let closeEnd = pos;
            let dm: RegExpExecArray | null;
            while (depth > 0 && (dm = closeRe.exec(sanitizedHtml)) !== null) {
                if (/^<button\b/i.test(dm[0])) depth++;
                else { depth--; if (depth === 0) closeEnd = dm.index + dm[0].length; }
            }
            if (depth !== 0) continue; // malformed — skip
            const fullElement = sanitizedHtml.slice(m.index, closeEnd);
            nodes.push({ html: fullElement, target: ["button[aria-pressed='true']"] });
        }
        if (nodes.length > 0) synthetic.push(makeViolation(
            "aria-pressed-static", "serious",
            "aria-pressed='true' on a non-toggle button is a static state that cannot change",
            "aria-pressed indicates a toggle state. A static permanent 'true' value misleads screen reader users into thinking a state change will occur.",
            nodes
        ));
    }

    // SYNTHETIC 5: redundant-button-role — role="button" on native <button>
    // v22: Reverted v21 rawHtml reverse-normalization (same wrong-direction issue as SYNTHETIC 4).
    // v22: Full-element capture — captures complete <button>...</button> so findCurrentNodeHtml
    // has a more unique, resilient search string that survives adjacent structural changes.
    if (!existingIds.has("redundant-button-role")) {
        const nodes: { html: string; target: string[] }[] = [];
        const redundantOpenRegex = /<button\b[^>]*\brole=["']button["'][^>]*>/gi;
        let m: RegExpExecArray | null;
        while ((m = redundantOpenRegex.exec(sanitizedHtml)) !== null) {
            const openTag = m[0];
            // Full-element depth-counter walk to closing </button>
            let depth = 1;
            let pos = m.index + openTag.length;
            const closeRe = /<button\b[^>]*>|<\/button>/gi;
            closeRe.lastIndex = pos;
            let closeEnd = pos;
            let dm: RegExpExecArray | null;
            while (depth > 0 && (dm = closeRe.exec(sanitizedHtml)) !== null) {
                if (/^<button\b/i.test(dm[0])) depth++;
                else { depth--; if (depth === 0) closeEnd = dm.index + dm[0].length; }
            }
            if (depth !== 0) continue; // malformed — skip
            const fullElement = sanitizedHtml.slice(m.index, closeEnd);
            nodes.push({ html: fullElement, target: ["button[role=button]"] });
        }
        if (nodes.length > 0) synthetic.push(makeViolation(
            "redundant-button-role", "moderate",
            "role='button' on a native <button> element is redundant",
            "Native <button> elements already have implicit button semantics. Adding role='button' is unnecessary and can confuse some assistive technologies.",
            nodes
        ));
    }

    // SYNTHETIC 6: color-contrast-inline
    // Root cause this fixes: axe reports color-contrast violations with RGB node HTML
    // (e.g. style="color: rgb(204, 204, 204)") but masterHtml contains hex source
    // (e.g. style="color:#cccccc"). findCurrentNodeHtml in studio does a string search —
    // RGB !== hex → fingerprint miss → fix silently skipped every time.
    //
    // Solution: scan sanitizedHtml (hex source) directly. The synthetic violation's html
    // field IS the sanitized source string → findCurrentNodeHtml always matches it.
    // The offline case "color-contrast-inline" applies PATH A logic (same YIQ formula).
    //
    // Scope: <p>, <span>, <div>, <li>, <td>, <th>, <a>, <h1>-<h6> with inline
    // style="color:#hex" where YIQ brightness > 180 (i.e. light text on presumed white bg).
    // Guard: skips elements that also have background-color in the same inline style
    // (those are handled correctly by axe + PATH A since the bg is inline and renders consistently).
    // Guard: skips if axe already produced a color-contrast violation for this exact html string
    // (avoids double-fixing the rare case where fingerprint DOES match).
    if (!existingIds.has("color-contrast-inline")) {
        const inlineColorRegex = /<(p|span|div|li|td|th|a|h[1-6])\b([^>]*\bstyle=["'][^"']*(?<![a-z-])color\s*:\s*#([0-9a-fA-F]{3,6})[^"']*["'][^>]*)>/gi;
        const ccNodes: { html: string; target: string[] }[] = [];
        const existingCcHtmls = new Set(
            existingViolations
                .filter(v => v.id === "color-contrast")
                .flatMap(v => v.nodes.map(n => n.html))
        );
        let ccm: RegExpExecArray | null;
        while ((ccm = inlineColorRegex.exec(sanitizedHtml)) !== null) {
            const openTag = ccm[0];
            const styleContent = openTag.match(/\bstyle=["']([^"']*)["']/i)?.[1] ?? "";
            // Skip if background-color also in inline style — axe handles those correctly
            if (/\bbackground-color\s*:/i.test(styleContent) || /(?<!background-)background\s*:/i.test(styleContent)) continue;
            const hexRaw = styleContent.match(/(?<![a-z-])color\s*:\s*#([0-9a-fA-F]{3,6})/i)?.[1] ?? "";
            if (!hexRaw) continue;
            const hex = hexRaw.length === 3 ? hexRaw.split('').map(c => c + c).join('') : hexRaw;
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            // v21: Threshold corrected from <= 180 → <= 128, matching detectCssClassContrast scanner.
            // Catches #aaaaaa (170), #999 (153), #888 (136). Skips #767676 (118 — WCAG AA passing).
            if (brightness <= 128) continue;
            // Skip if axe already flagged this exact source string (fingerprint matched)
            if (existingCcHtmls.has(openTag)) continue;
            ccNodes.push({ html: openTag, target: [`${ccm[1]}[style*="color"]`] });
        }
        if (ccNodes.length > 0) {
            synthetic.push(makeViolation(
                "color-contrast-inline", "serious",
                "Element has low-contrast inline text color",
                "Inline style sets a text color with insufficient contrast against white background (WCAG AA requires 4.5:1). Detected from source HTML to avoid Puppeteer RGB\u2192hex fingerprint mismatch.",
                ccNodes
            ));
        }
    }
    return [...existingViolations, ...synthetic];
}

// ─── Route Handler ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    let body: { url?: string; htmlContent?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { url, htmlContent } = body;

    // We need either a URL or raw HTML to scan
    if (!url && !htmlContent) {
        return NextResponse.json({ error: "Missing 'url' or 'htmlContent' field" }, { status: 400 });
    }

    // Only validate the URL strictly if we don't have raw HTML content
    if (url && !htmlContent) {
        try {
            const parsedUrl = new URL(url);
            if (!["http:", "https:"].includes(parsedUrl.protocol)) {
                return NextResponse.json({ error: "Only http/https URLs are allowed" }, { status: 400 });
            }
        } catch {
            return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
        }
    }

    const _require = createRequire(import.meta.url);
    const axeCorePath = _require.resolve("axe-core");
    const axeCoreSource = readFileSync(axeCorePath, "utf-8");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // ── Navigation Logic: URL vs Uploaded HTML ──
        if (htmlContent) {
            // For uploaded files, set the content directly
            await page.setContent(htmlContent, { waitUntil: "domcontentloaded", timeout: 60000 });
        } else if (url) {
            // For live URLs, navigate normally
            await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
        }

        const rawHtml = await page.content();
        const sanitizedHtml = sanitizeHtml(rawHtml);

        await page.evaluate(axeCoreSource);

        const axeResults = await page.evaluate(async () => {
            // @ts-expect-error
            const results = await window.axe.run(document, {
                runOnly: {
                    type: "tag",
                    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
                },
            });
            return {
                violations: results.violations,
                passes: results.passes.length,
            };
        });

        const seoData = await page.evaluate(() => {
            const checks = [];
            const title = document.title || "";
            checks.push({
                id: "seo-title",
                status: title.trim().length > 0 ? "pass" : "fail",
                title: "Page Title",
                description: "Pages must have a non-empty <title> tag for search engines.",
                actualValue: title || "Missing"
            });

            const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
            checks.push({
                id: "seo-meta-desc",
                status: metaDesc.trim().length > 0 ? "pass" : "fail",
                title: "Meta Description",
                description: "Pages should have a meta description for search engine snippets.",
                actualValue: metaDesc || "Missing"
            });

            const h1Count = document.querySelectorAll('h1').length;
            checks.push({
                id: "seo-h1",
                status: h1Count === 1 ? "pass" : "fail",
                title: "Primary Heading (H1)",
                description: "Pages should have exactly one <h1> tag for optimal SEO structure.",
                actualValue: `Found ${h1Count} <h1> tag(s)`
            });
            return checks;
        });

        await browser.close();
        browser = undefined;

        const axeViolations = axeResults.violations as AxeViolation[];
        const enrichedViolations = injectSyntheticViolations(sanitizedHtml, axeViolations);

        const response: ScanResponse = {
            url: url || "uploaded-file.html",
            rawHtml,
            sanitizedHtml,
            violations: enrichedViolations,
            passes: axeResults.passes as number,
            seoResults: seoData as SeoCheck[],
            timestamp: new Date().toISOString(),
        };

        return NextResponse.json(response);

    } catch (err) {
        if (browser) await browser.close().catch(() => { });
        const message = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: `Scan failed: ${message}` }, { status: 500 });
    }
}
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
    if (!existingIds.has("image-alt-filename")) {
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
        if (nodes.length > 0) synthetic.push(makeViolation(
            "image-alt-filename", "serious",
            "Image alt text is a file path or generic word, not a description",
            "Alt text that is a filename, URL, or generic term like 'image' does not convey meaning to screen reader users.",
            nodes
        ));
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
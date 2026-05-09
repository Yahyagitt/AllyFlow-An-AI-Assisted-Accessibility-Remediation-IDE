import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";
import { readFileSync } from "fs";
import { createRequire } from "module";
import type { AxeViolation, ScanResponse, SeoCheck } from "@/lib/scan-types";

// Re-export so existing imports from this file continue to work
export type { AxeViolation, ScanResponse, SeoCheck } from "@/lib/scan-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Snapshot Policy (AllyFlow rule):
 * Strip all <script> tags and all on* event attributes from the DOM string.
 * This sanitizes the snapshot before rendering in the preview.
 */
function sanitizeHtml(rawHtml: string): string {
    return rawHtml
        // Remove all <script>…</script> blocks (including inline scripts)
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        // Remove all on* event handler attributes (onclick, onload, onerror, etc.)
        .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        // Remove noscript blocks too for clean snapshot
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    let body: { url?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { url } = body;
    if (!url || typeof url !== "string") {
        return NextResponse.json({ error: "Missing or invalid 'url' field" }, { status: 400 });
    }

    // Basic URL safety check
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return NextResponse.json({ error: "Only http/https URLs are allowed" }, { status: 400 });
    }

    // Load axe-core source to inject into the page
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

        // Navigate to target URL
        await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 30_000,
        });

        // ── Stage 1: Snapshot Policy ─────────────────────────────────────────────
        const rawHtml = await page.content();
        const sanitizedHtml = sanitizeHtml(rawHtml);

        // ── Stage 2: Axe Audit ───────────────────────────────────────────────────
        await page.evaluate(axeCoreSource);

        const axeResults = await page.evaluate(async () => {
            // @ts-expect-error — axe is injected into the page context
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

        // ── Stage 3: Custom SEO Extraction (NEW FOR DAY 4) ───────────────────────
        const seoData = await page.evaluate(() => {
            const checks = [];

            // 1. Title Check
            const title = document.title || "";
            checks.push({
                id: "seo-title",
                status: title.trim().length > 0 ? "pass" : "fail",
                title: "Page Title",
                description: "Pages must have a non-empty <title> tag for search engines.",
                actualValue: title || "Missing"
            });

            // 2. Meta Description Check
            const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
            checks.push({
                id: "seo-meta-desc",
                status: metaDesc.trim().length > 0 ? "pass" : "fail",
                title: "Meta Description",
                description: "Pages should have a meta description for search engine snippets.",
                actualValue: metaDesc || "Missing"
            });

            // 3. H1 Heading Check
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

        // Attach the new seoData to the final response
        const response: ScanResponse = {
            url,
            sanitizedHtml,
            violations: axeResults.violations as AxeViolation[],
            passes: axeResults.passes as number,
            seoResults: seoData as SeoCheck[],
            timestamp: new Date().toISOString(),
        };

        return NextResponse.json(response);
    } catch (err) {
        if (browser) {
            await browser.close().catch(() => { });
        }
        console.error("[AllyFlow scan error]", err);
        const message = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json(
            { error: `Scan failed: ${message}` },
            { status: 500 }
        );
    }
}
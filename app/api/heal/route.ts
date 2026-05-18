import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AxeViolation } from "@/lib/scan-types";

export interface HealRequest {
    violation: AxeViolation;
    nodeHtml: string;
}

export interface HealResponse {
    original: string;
    fixed: string;
    strategy: "gemini" | "heuristic-fallback";
    description: string;
}

// Normalize onclick → data-af-onclick so the string matches the sanitized DOM
function normalizeToDom(html: string): string {
    // Only normalize if not already normalized (prevent data-af-data-af- doubling)
    return html.replace(/(?<!data-af-)\b(on[a-z]+)\s*=/gi, "data-af-$1=");
}

// Fetch image as base64 for Gemini Vision (6s timeout)
async function fetchImageAsBase64(url: string) {
    try {
        if (!url.startsWith("http")) return null;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeType = response.headers.get("content-type") || "image/jpeg";
        return { inlineData: { data: buffer.toString("base64"), mimeType } };
    } catch {
        return null;
    }
}

// ─── OFFLINE FALLBACK ───────────────────────────────────────────────────────
// This ONLY runs when Gemini is unavailable (quota/rate-limit).
// It is NOT called before AI — it is the safety net AFTER AI fails.
function applyOfflineFix(violation: AxeViolation, nodeHtml: string): string {
    let fixed = nodeHtml.trim();

    // Rule 1: <a class="demo-btn"> or any <a data-af-onclick> → <button>
    if (
        /\bclass=["'].*demo-btn.*["']/i.test(fixed) ||
        /data-af-onclick/i.test(fixed)
    ) {
        if (/^<a\b/i.test(fixed)) {
            fixed = fixed.replace(/^<a\b/i, "<button");
            fixed = fixed.replace(/<\/a>$/i, "</button>");
            if (!/background-color/i.test(fixed)) {
                fixed = fixed.replace(
                    /^<button/i,
                    '<button style="background-color:#000000;color:#ffffff;border:none;padding:10px 20px;border-radius:5px;cursor:pointer;font-weight:bold;"'
                );
            }
        }
    }

    // Rule 2: <div role="button"> → <button>
    if (/role=["']button["']/i.test(fixed)) {
        fixed = fixed.replace(/^<div\b/i, "<button");
        fixed = fixed.replace(/<\/div>$/i, "</button>");
        fixed = fixed.replace(/\s*role=["']button["']/gi, "");
        fixed = fixed.replace(/aria-pressed=["']yes["']/gi, 'aria-pressed="true"');
    }

    // Rule 3: Color contrast — force black bg / white text
    if (violation.id === "color-contrast") {
        fixed = fixed.replace(/background-color\s*:\s*#[0-9a-fA-F]{3,6}/gi, "background-color:#000000");
        fixed = fixed.replace(/background-color\s*:\s*white\b/gi, "background-color:#000000");
        fixed = fixed.replace(/(?<![-\w])color\s*:\s*#[0-9a-fA-F]{3,6}/gi, "color:#ffffff");
        fixed = fixed.replace(/(?<![-\w])color\s*:\s*white\b/gi, "color:#ffffff");
        fixed = fixed.replace(/(?<![-\w])color\s*:\s*black\b/gi, "color:#ffffff");
    }

    // Rule 4: Image missing alt — use filename or generic
    if (violation.id === "image-alt" && /<img\s/i.test(fixed) && !/\balt=/i.test(fixed)) {
        const srcMatch = fixed.match(/src=["']([^"']+)["']/i);
        let altText = "Featured product image";
        if (srcMatch) {
            const filename = srcMatch[1].split("/").pop()?.split("?")[0] ?? "";
            const isMeaningless =
                !filename ||
                !/\.[a-z]{2,4}$/i.test(filename) ||
                /\d{8,}/.test(filename) ||
                /^[a-f0-9-]{20,}$/i.test(filename);
            if (!isMeaningless) {
                altText =
                    filename
                        .replace(/[-_]/g, " ")
                        .replace(/\.[^.]+$/, "")
                        .trim() || "Featured product image";
            }
        }
        fixed = fixed.replace(/<img\s/i, `<img alt="${altText}" `);
    }

    // Rule 5: Input missing label
    if (
        (violation.id === "label" || violation.id === "region") &&
        /<input/i.test(fixed) &&
        !/aria-label=/i.test(fixed)
    ) {
        const placeholderMatch = fixed.match(/placeholder=["'](.*?)["']/i);
        const labelText = placeholderMatch ? placeholderMatch[1] : "Input field";
        fixed = fixed.replace(/<input\b/i, `<input aria-label="${labelText}" `);
    }

    return fixed;
}

// ─── GEMINI PROMPT BUILDER ──────────────────────────────────────────────────
function buildPrompt(violation: AxeViolation, nodeHtml: string, hasImage: boolean): string {
    if (violation.id === "image-alt") {
        if (hasImage) {
            return `You are a web accessibility expert. Examine the image carefully.
Write a concise, accurate alt attribute (under 125 characters) describing what is shown.
Return ONLY the complete fixed <img> HTML tag with the alt attribute added. No markdown, no backticks, no explanation.

HTML to fix:
${nodeHtml.trim()}`;
        } else {
            const srcUrl = nodeHtml.match(/src=["']([^"']+)["']/i)?.[1] || "unknown";
            return `You are a web accessibility expert.
Based on this image URL, write a descriptive alt attribute: ${srcUrl}
Return ONLY the complete fixed <img> HTML tag with a meaningful alt attribute. No markdown, no backticks.

HTML to fix:
${nodeHtml.trim()}`;
        }
    }

    if (violation.id === "document-title") {
        return `You are a web accessibility expert. This HTML page is missing a <title> element.
Add an appropriate <title> inside the <head> tag based on the page content.
Return ONLY the fixed HTML. No markdown, no backticks.

HTML to fix:
${nodeHtml.trim()}`;
    }

    if (violation.id === "landmark-one-main") {
        return `You are a web accessibility expert. The page content is not wrapped in a <main> landmark.
Show how to wrap the main content in a <main> element with a comment explaining the fix.
Return ONLY the fixed HTML. No markdown, no backticks.

HTML to fix:
${nodeHtml.trim()}`;
    }

    // General prompt for all other violations
    return `You are a strict web accessibility code-rewriter. Fix the WCAG violation described below.
Return ONLY the corrected raw HTML. No markdown, no backticks, no explanation.

WCAG RULE: ${violation.id}
DESCRIPTION: ${violation.help}

EXAMPLES OF CORRECT FIXES:
Input:  <div role="button" aria-pressed="yes" data-af-onclick="foo()">Click</div>
Output: <button aria-pressed="true" data-af-onclick="foo()">Click</button>

Input:  <a class="demo-btn" data-af-onclick="bar()">Add to Cart</a>
Output: <button style="background-color:#000000;color:#ffffff;border:none;padding:10px 20px;border-radius:5px;cursor:pointer;font-weight:bold;" data-af-onclick="bar()">Add to Cart</button>

Input:  <div style="color:#ffffff;background-color:#ffffff;">Warning text</div>
Output: <div style="color:#ffffff;background-color:#000000;">Warning text</div>

Input:  <input type="email" placeholder="Enter email">
Output: <input type="email" placeholder="Enter email" aria-label="Enter email">

NOW FIX THIS:
${nodeHtml.trim()}`;
}

// ─── MULTI-MODEL GEMINI CALLER ──────────────────────────────────────────────
// Tries models in order. Each has its own quota bucket.
async function callGeminiWithFallback(
    apiKey: string,
    contentParts: any[],
    temperature = 0.1
): Promise<string> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"];

    let lastError: unknown;
    for (const modelName of models) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: { temperature },
            });
            const result = await model.generateContent(contentParts);
            const text = result.response.text().trim();
            // Strip any markdown fences Gemini sometimes adds
            return text
                .replace(/^```html\s*/i, "")
                .replace(/^```\s*/i, "")
                .replace(/\s*```$/i, "")
                .trim();
        } catch (err) {
            lastError = err;
            // 429 = quota, 503 = overloaded — try next model
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("429") || msg.includes("503") || msg.includes("quota") || msg.includes("overload")) {
                continue;
            }
            // Any other error — don't bother trying next model
            throw err;
        }
    }
    throw lastError;
}

// ─── MAIN HEALING FUNCTION ──────────────────────────────────────────────────
async function applyGeminiFix(violation: AxeViolation, nodeHtml: string): Promise<HealResponse> {
    const normalizedOriginal = normalizeToDom(nodeHtml);

    // Structural tags (full <html> or <body>) — guide the developer manually
    const trimmedLower = normalizedOriginal.trim().toLowerCase();
    if (trimmedLower.startsWith("<html") || trimmedLower.startsWith("<body")) {
    if (violation.id === "landmark-one-main") {
        return {
            original: normalizedOriginal,
            fixed: normalizedOriginal,
            strategy: "heuristic-fallback",
            description: "Wrap your page's main content in <main>…</main> manually in the right pane. Place it after your <header> and before your <footer>.",
        };
    }
    if (violation.id !== "document-title") {
        return {
            original: normalizedOriginal,
            fixed: normalizedOriginal,
            strategy: "heuristic-fallback",
            description: "Structural tags must be fixed manually in the right pane.",
        };
    }
}

    const isImageAlt =
        violation.id === "image-alt" &&
        /<img\s/i.test(normalizedOriginal) &&
        !/\balt=/i.test(normalizedOriginal);

    const apiKey = process.env.GEMINI_API_KEY;

    // ── TRY GEMINI FIRST ────────────────────────────────────────────────────
    if (apiKey) {
        const MAX_SNIPPET_CHARS = 800;
        const safeSnippet =
            normalizedOriginal.length > MAX_SNIPPET_CHARS
                ? normalizedOriginal.slice(0, MAX_SNIPPET_CHARS) + "\n...[truncated]..."
                : normalizedOriginal;

        // For image-alt: fetch the actual image so Gemini can SEE it
        let imagePart: { inlineData: { data: string; mimeType: string } } | null = null;
        if (isImageAlt) {
            const srcMatch = nodeHtml.match(/src=["']([^"']+)["']/i);
            if (srcMatch?.[1]) {
                imagePart = await fetchImageAsBase64(srcMatch[1]);
            }
        }

        const promptText = buildPrompt(violation, safeSnippet, !!imagePart);
        const contentParts: any[] = imagePart ? [promptText, imagePart] : [promptText];

        try {
            const fixedHtml = await callGeminiWithFallback(apiKey, contentParts);

            // If Gemini returned nothing useful, fall through to offline
            if (fixedHtml && fixedHtml !== normalizedOriginal.trim()) {
                return {
                    original: normalizedOriginal,
                    fixed: fixedHtml,
                    strategy: "gemini",
                    description: isImageAlt
                        ? imagePart
                            ? "AI Vision: alt text generated by Gemini seeing the actual image"
                            : "AI: alt text inferred from image URL"
                        : `AI fix applied for: ${violation.help}`,
                };
            }
            // Gemini returned the same HTML (was passive) — fall through to offline
        } catch {
            // All Gemini models exhausted or failed — fall through to offline
        }
    }

    // ── OFFLINE FALLBACK (only when Gemini unavailable or passive) ──────────
    const offlineFixed = applyOfflineFix(violation, normalizedOriginal);

    if (offlineFixed !== normalizedOriginal.trim()) {
        return {
            original: normalizedOriginal,
            fixed: offlineFixed,
            strategy: "heuristic-fallback",
            description: "AI quota exhausted — heuristic fix applied. Results may be less precise.",
        };
    }

    // Nothing worked — open diff editor for manual editing
    return {
        original: normalizedOriginal,
        fixed: normalizedOriginal,
        strategy: "heuristic-fallback",
        description: "No automated fix available. Edit the right pane manually.",
    };
}

// ─── ROUTE HANDLER ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    let body: Partial<HealRequest>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { violation, nodeHtml } = body;
    if (!violation || !nodeHtml) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    try {
        const result = await applyGeminiFix(violation, nodeHtml);
        return NextResponse.json(result);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: `Heal failed: ${message}` }, { status: 500 });
    }
}

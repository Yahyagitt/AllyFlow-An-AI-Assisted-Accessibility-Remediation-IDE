import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { BestPracticeViolation, BestPracticesHealResponse } from "@/lib/best-practices-types";

// ─── BEST PRACTICES PROMPT ──────────────────────────────────────────────────
const BEST_PRACTICES_PROMPT = `You are AllyFlow's best-practices repair engine. Given a violation ID, description, and HTML snippet, return ONLY the corrected raw HTML. No markdown. No backticks. No explanation. Preserve every attribute and inner content not causing the violation.

RULE CATALOGUE:

[semantic-button] Convert non-button interactive elements to native <button>. Preserve ALL inner markup exactly — including SVG icons, nested spans, images, and any child elements. Preserve class, id, and data-af-on* event attributes. Remove href="#" or href="javascript:void(0)". Remove role="button" (native button does not need it). Never truncate or simplify inner content.
  <a class="btn" data-af-onclick="save()"><svg aria-hidden="true">...</svg> Save</a> → <button class="btn" data-af-onclick="save()"><svg aria-hidden="true">...</svg> Save</button>
  <div role="button" data-af-onclick="go()">Go</div> → <button data-af-onclick="go()">Go</button>

[persistent-label] Add aria-label to form controls. Derive label from: placeholder > name > id > type. Do NOT wrap in <label>.
  <input type="email" placeholder="Email"> → <input type="email" placeholder="Email" aria-label="Email">
  <select name="country"><option>Choose</option></select> → <select name="country" aria-label="Country"><option>Choose</option></select>

[keyboard-trap] Add tabindex="0" role="button" and aria-label (from inner text) to clickable containers.
  <div data-af-onclick="open()">Open menu</div> → <div tabindex="0" role="button" aria-label="Open menu" data-af-onclick="open()">Open menu</div>

[focus-indicator] Replace outline:none or outline:0 with outline:2px solid #005fcc;outline-offset:2px. Keep all other styles.
  <a style="outline:none;color:blue">Link</a> → <a style="outline:2px solid #005fcc;outline-offset:2px;color:blue">Link</a>

[fake-form-control] Add role="radio" or role="checkbox" (infer from class name), aria-checked="false", and tabindex="0" to the element's opening tag. Do NOT convert to <button>. Do NOT remove or alter any existing attribute or inner content.
  <div class="radio" id="alphaRadio"></div> → <div class="radio" id="alphaRadio" role="radio" aria-checked="false" tabindex="0"></div>
  <span class="checkbox-custom" id="agreeBox"></span> → <span class="checkbox-custom" id="agreeBox" role="checkbox" aria-checked="false" tabindex="0"></span>

[negative-tabindex] Remove the tabindex="-1" attribute entirely. Preserve all other attributes and content exactly.
  <a tabindex="-1" href="#section" class="nav-btn">Skip</a> → <a href="#section" class="nav-btn">Skip</a>

[new-tab-warning] Add or extend aria-label to include "(opens in new tab)" for any link with target="_blank". If aria-label already exists, append the phrase. If not, add aria-label="Link (opens in new tab)".
  <a href="report.pdf" target="_blank"> → <a href="report.pdf" target="_blank" aria-label="Link (opens in new tab)">
  <a href="x" target="_blank" aria-label="Download report"> → <a href="x" target="_blank" aria-label="Download report (opens in new tab)">

[landmark-containment] When fixing loose content that needs a landmark wrapper:
  - NEVER use the generic label "Content region", "Region", "Section", "Area", or any
    placeholder text. Generic landmark labels are a WCAG failure, not a fix.
  - Derive the landmark label from: the nearest heading, the existing aria-label, the
    field purpose, or what the content functionally IS on the page.
  - Choose the most semantically precise element available:
      • Form controls (input, select, textarea, fieldset) → add aria-label directly to
        the control. Do NOT wrap a lone input in role="region" or any landmark wrapper.
        If a form context is genuinely needed:
        <form aria-label="[field purpose] form"><input .../></form>
      • Navigation links → <nav aria-label="[specific nav purpose]">
      • Primary page content → <main>
      • Supporting/secondary content → <aside aria-label="[specific description]">
      • Thematic grouped content with a visible heading → <section aria-label="[heading text]">
      • Only use role="region" when NONE of the above semantic elements fit AND you can
        supply a specific, meaningful, non-generic aria-label.
  - If the element already has a landmark ancestor that this fix would duplicate, fix the
    attribute on the existing ancestor instead of adding a new wrapper.
  - NEVER nest two landmarks of the same type (e.g. two role="region" wrappers,
    two <nav> elements with the same label, <main> inside <main>).
  - This rule applies to ALL websites — do not assume a specific CMS or framework.

[aria-roles-consistency] When fixing invalid ARIA roles:
  - All sibling elements that share the same structural purpose MUST receive the SAME role.
  - Content cards, info panels, feature tiles, product cards, category sections → role="article"
  - NEVER mix role="region" and role="article" on elements serving the same function.
  - role="region" is reserved for major uniquely-named page sections (e.g. a "Breaking News"
    band, a "Search results" section). It is NOT correct for product cards, info tiles,
    disability category panels, or any repeating card pattern.
  - When siblings are visible in the provided HTML snippet, apply the same role to all of them.
  - When fixing in isolation (only one element provided), choose role="article" for cards
    and do not introduce role="region" — consistency across the page is the developer's
    responsibility for elements not in this snippet.
  - Do not replace a valid existing role (e.g. role="tabpanel", role="dialog") with
    role="article" — only replace genuinely invalid or incorrect roles.`;

// ─── HELPERS ────────────────────────────────────────────────────────────────

function getInnerText(html: string, tag: string): string {
    const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
}

// Preserves child elements (SVG icons, spans, nested markup) intact.
// Used for semantic tag conversions where inner markup must survive the tag rename.
// Do NOT use for aria-label generation — use getInnerText for that.
function getInnerHtml(html: string, tag: string): string {
    const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? m[1] : "";
}

function inferLabel(html: string): string {
    const placeholder = html.match(/placeholder=["'](.*?)["']/i)?.[1];
    if (placeholder) return placeholder;
    const name = html.match(/name=["'](.*?)["']/i)?.[1];
    if (name) return name.replace(/[-_]/g, " ").replace(/([A-Z])/g, " $1").trim();
    const id = html.match(/id=["'](.*?)["']/i)?.[1];
    if (id) return id.replace(/[-_]/g, " ").replace(/([A-Z])/g, " $1").trim();
    const type = html.match(/type=["'](.*?)["']/i)?.[1];
    if (type) return type.charAt(0).toUpperCase() + type.slice(1) + " field";
    return "Input field";
}

// ─── OFFLINE HEURISTIC FALLBACK ─────────────────────────────────────────────
function applyOfflineFix(violation: BestPracticeViolation, nodeHtml: string): string {
    let fixed = nodeHtml.trim();
    const vid = violation.id;

    if (vid === "semantic-button") {
        // <a> → <button>
        if (/^<a\b/i.test(fixed)) {
            const inner = getInnerHtml(fixed, "a");  // preserve SVG icons and nested elements
            const events = [...fixed.matchAll(/data-af-on\w+=["'][^"']*["']/gi)].map((m) => m[0]).join(" ");
            const classMatch = fixed.match(/\bclass=["']([^"']*)["']/i);
            const classAttr = classMatch ? ` class="${classMatch[1]}"` : "";
            const idMatch = fixed.match(/\bid=["']([^"']*)["']/i);
            const idAttr = idMatch ? ` id="${idMatch[1]}"` : "";
            fixed = `<button${idAttr}${classAttr}${events ? " " + events : ""}>${inner}</button>`;
        }
        // <div|span|li|p> → <button>
        // P3: Preserve aria-expanded (accordion) and aria-label through the conversion
        if (/^<(div|span|li|p)\b/i.test(fixed)) {
            const tag = fixed.match(/^<(\w+)\b/i)?.[1] ?? "div";
            const inner = getInnerHtml(fixed, tag);  // preserve SVG icons and nested elements
            const events = [...fixed.matchAll(/data-af-on\w+=["'][^"']*["']/gi)].map((m) => m[0]).join(" ");
            const classMatch = fixed.match(/\bclass=["']([^"']*)["']/i);
            const classAttr = classMatch ? ` class="${classMatch[1]}"` : "";
            const idMatch = fixed.match(/\bid=["']([^"']*)["']/i);
            const idAttr = idMatch ? ` id="${idMatch[1]}"` : "";
            const ariaExpanded = fixed.match(/\baria-expanded=["'][^"']*["']/i)?.[0] ?? "";
            const ariaLabel = fixed.match(/\baria-label=["'][^"']*["']/i)?.[0] ?? "";
            fixed = `<button${idAttr}${classAttr}${ariaExpanded ? " " + ariaExpanded : ""}${ariaLabel ? " " + ariaLabel : ""}${events ? " " + events : ""}>${inner}</button>`;
        }
    }

    if (vid === "persistent-label") {
        const tagMatch = fixed.match(/^<(input|select|textarea)\b/i);
        if (tagMatch && !/aria-label=/i.test(fixed)) {
            const tag = tagMatch[1].toLowerCase();
            const label = inferLabel(fixed);
            fixed = fixed.replace(new RegExp(`<${tag}\\b`, "i"), `<${tag} aria-label="${label}" `);
        }
    }

    if (vid === "keyboard-trap") {
        if (!/tabindex=/i.test(fixed)) {
            const tagMatch = fixed.match(/^<(\w+)\b/i);
            const tag = tagMatch?.[1] ?? "div";
            const innerText = getInnerText(fixed, tag).slice(0, 50) || "Interactive content";
            fixed = fixed.replace(
                /^<(\w+)\b/i,
                `<$1 tabindex="0" role="button" aria-label="${innerText}"`
            );
        }
    }

    if (vid === "focus-indicator") {
        fixed = fixed.replace(
            /outline\s*:\s*(none|0(?:px)?)/gi,
            "outline:2px solid #005fcc;outline-offset:2px"
        );
    }

    // ── Extended offline cases for new violation IDs ───────────────────────
    switch (vid) {
        case "negative-tabindex":
            fixed = fixed.replace(/\s*tabindex=["']-\d+["']/gi, "");
            break;
        case "fake-form-control": {
            // Only add ARIA attrs if not already present — idempotent on re-scan
            if (!/\brole=/i.test(fixed)) {
                const isRadio = /radio/i.test(fixed);
                const role = isRadio ? "radio" : "checkbox";
                // Handles both > and /> endings; does NOT wrap in <button>
                fixed = fixed.replace(
                    /(<(?:div|span)\b[^>]*?)(\/?>)/i,
                    `$1 role="${role}" aria-checked="false" tabindex="0"$2`
                );
            }
            break;
        }
        case "new-tab-warning":
            fixed = fixed.replace(/^(<a\b[^>]*)>/i, (_: string, open: string) => {
                if (/aria-label=/i.test(open))
                    return open.replace(/aria-label=["']([^"']*)["']/i,
                        (_2: string, v: string) => `aria-label="${v} (opens in new tab)"`) + ">";
                return `${open} aria-label="Link (opens in new tab)">`;
            });
            break;

    }

    return fixed;
}

// ─── OUTPUT CLEANER ─────────────────────────────────────────────────────────
function cleanGeminiOutput(raw: string): string {
    let text = raw.trim();
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    const lines = text.split("\n");
    const firstTagLine = lines.findIndex(l => l.trim().startsWith("<"));
    if (firstTagLine > 0) text = lines.slice(firstTagLine).join("\n").trim();
    const outLines = text.split("\n");
    while (outLines.length > 0) {
        const last = outLines[outLines.length - 1].trim();
        if (last && !last.includes("<") && /^[A-Z]/.test(last)) outLines.pop();
        else break;
    }
    return outLines.join("\n").trim();
}

// ─── MULTI-MODEL GEMINI CALLER ──────────────────────────────────────────────
async function callGeminiWithFallback(apiKey: string, prompt: string, temperature = 0.1): Promise<string> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
    let lastError: unknown;
    for (const modelName of models) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { temperature } });
            const result = await model.generateContent(prompt);
            const raw = result.response.text();
            return cleanGeminiOutput(raw);
        } catch (err) {
            lastError = err;
            const msg = err instanceof Error ? err.message : String(err);
            // Fast-fail on quota errors — all models share the same quota
            if (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate limit")) break;
            if (msg.includes("503") || msg.includes("overload")) continue;
            throw err;
        }
    }
    throw lastError;
}

// ─── MAIN HEALING FUNCTION ──────────────────────────────────────────────────
async function applyBestPracticesFix(violation: BestPracticeViolation, nodeHtml: string): Promise<BestPracticesHealResponse> {
    const original = nodeHtml.trim();
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey) {
        const MAX_SNIPPET = 800;
        const safeSnippet = original.length > MAX_SNIPPET ? original.slice(0, MAX_SNIPPET) + "\n...[truncated]..." : original;

        const prompt = `${BEST_PRACTICES_PROMPT}\n\nVIOLATION: ${violation.id}\nDESCRIPTION: ${violation.description}\n\nHTML TO FIX:\n${safeSnippet}`;

        try {
            const fixedHtml = await callGeminiWithFallback(apiKey, prompt);
            if (fixedHtml && fixedHtml !== original) {
                // Normalize event handlers in Gemini output — Gemini may rewrite
                // data-af-onclick back to onclick, bypassing the sanitization pipeline.
                // Negative lookbehind prevents double-normalizing data-af-onclick → data-af-data-af-onclick.
                // This is defence layer 1 (route); page.tsx setHealResult is defence layer 2.
                const normalizedFixed = fixedHtml.replace(/(?<!data-af-)\b(on[a-z]+)\s*=/gi, "data-af-$1=");
                return {
                    original,
                    fixed: normalizedFixed,
                    strategy: "gemini",
                    description: `AI fix applied for: ${violation.title}`,
                };
            }
        } catch {
            // All Gemini models exhausted — fall through to offline
        }
    }

    const offlineFixed = applyOfflineFix(violation, original);
    if (offlineFixed !== original) {
        return {
            original,
            fixed: offlineFixed,
            strategy: "heuristic-fallback",
            description: "AI quota exhausted — heuristic fix applied. Review before applying.",
        };
    }

    return {
        original,
        fixed: original,
        strategy: "heuristic-fallback",
        description: "No automated fix available for this pattern. Edit the right pane manually.",
    };
}

// ─── ROUTE HANDLER ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    let body: { violation?: BestPracticeViolation; nodeHtml?: string };
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
        const result = await applyBestPracticesFix(violation, nodeHtml);
        return NextResponse.json(result);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: `Heal failed: ${message}` }, { status: 500 });
    }
}

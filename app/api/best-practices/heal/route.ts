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

// P15: SYNC-WARNING — isBadAlt and deriveAltFromFilename exist in app/api/heal/route.ts.
// Those functions are intentionally NOT duplicated here: BP heal violations do not include
// image-alt patterns, so the functions are not needed in this route.
// v11 update: isBadAlt in heal/route.ts had its empty-alt guard hardened (empty string now
// returns true instead of false). If image violations are ever routed through BP heal in the
// future, copy both functions from heal/route.ts at that time — do not copy the pre-v11 version.
// ─── OFFLINE HEURISTIC FALLBACK ─────────────────────────────────────────────
function applyOfflineFix(violation: BestPracticeViolation, nodeHtml: string): string {
    let fixed = nodeHtml.trim();
    const vid = violation.id;

    if (vid === "semantic-button") {
        // <a> → <button>
        if (/^<a\b/i.test(fixed)) {
            const inner = getInnerHtml(fixed, "a");  // preserve SVG icons and nested elements
            const events = [...fixed.matchAll(/data-af-on\w+=(?:"[^"]*"|'[^']*')/gi)].map((m) => m[0]).join(" ");
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
            const events = [...fixed.matchAll(/data-af-on\w+=(?:"[^"]*"|'[^']*')/gi)].map((m) => m[0]).join(" ");
            const classMatch = fixed.match(/\bclass=["']([^"']*)["']/i);
            const classAttr = classMatch ? ` class="${classMatch[1]}"` : "";
            const idMatch = fixed.match(/\bid=["']([^"']*)["']/i);
            const idAttr = idMatch ? ` id="${idMatch[1]}"` : "";
            const styleMatch = fixed.match(/\bstyle=["']([^"']*)["']/i);
            const styleAttr = styleMatch ? ` style="${styleMatch[1]}"` : "";
            const ariaExpanded = fixed.match(/\baria-expanded=["'][^"']*["']/i)?.[0] ?? "";
            const ariaLabel = fixed.match(/\baria-label=["'][^"']*["']/i)?.[0] ?? "";
            fixed = `<button${idAttr}${classAttr}${styleAttr}${ariaExpanded ? " " + ariaExpanded : ""}${ariaLabel ? " " + ariaLabel : ""}${events ? " " + events : ""}>${inner}</button>`;
        }
        // v18: aria-pressed normalization — applies to ALL semantic-button conversions above.
        // Runs unconditionally after both <a> and <div|span|li|p> conversion branches.
        // aria-pressed is ONLY valid on stateful toggle buttons.
        // Non-toggle (Add to Cart, Submit, Create Account, Checkout): strip entirely.
        // Toggle (mute, expand, accordion): normalize to "false" (never static "true").
        // Toggle detection: aria-expanded OR aria-controls OR toggle/switch/expand class.
        if (/\baria-pressed=/i.test(fixed)) {
            const isToggle = /aria-expanded/.test(fixed) || /aria-controls/.test(fixed) ||
                /\b(toggle|switch|expand|collapse|mute)\b/i.test(
                    (fixed.match(/\bclass=["']([^"']*)["']/i) ?? [])[1] ?? ""
                );
            if (isToggle) {
                fixed = fixed.replace(/\baria-pressed=["'][^"']*["']/g, 'aria-pressed="false"');
            } else {
                fixed = fixed.replace(/\s*\baria-pressed=["'][^"']*["']/g, "");
            }
        }
        // v18: Strip redundant role="button" from converted <button> elements.
        // Native <button> must never carry role="button" — axe flags aria-allowed-attr.
        fixed = fixed.replace(/\s*\brole=["']button["']/gi, "");
        // v24: Strip redundant tabindex="0" from converted <button> elements.
        // Native <button> is focusable by default — tabindex="0" is redundant noise.
        // Belt-and-suspenders safety net: catches tabindex="0" regardless of origin
        // (keyboard-trap injection, developer pre-authoring, Gemini preservation).
        // Only strips tabindex="0" — tabindex="-1" and tabindex="1+" are intentional and preserved.
        if (/^<button\b/i.test(fixed)) {
            fixed = fixed.replace(/\s*\btabindex=["']0["']/gi, "");
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
        // v17: Separated trap-stripping from attribute-injection.
        // Previously: aria-label was only injected when tabindex was absent.
        // Bug: the keyboard trap div in test.html already has tabindex="0" — so the
        // if(!tabindex) branch was skipped and no aria-label was ever injected.
        // The element ended up keyboard-accessible but with no accessible name — still bad.
        //
        // Fix: strip trap unconditionally, then inject missing attrs unconditionally.
        // Each attr injection is individually guarded — idempotent on re-scan.
        // Step 1: Always strip the preventDefault trap (the core WCAG 2.1.2 violation)
        fixed = fixed.replace(/\s*data-af-onkeydown=["'][^"']*preventDefault[^"']*["']/gi, "");
        // Step 2: Derive innerText for aria-label BEFORE any attribute injections
        const ktTagMatch = fixed.match(/^<(\w+)\b/i);
        const ktTag = ktTagMatch?.[1] ?? "div";
        const ktInnerText = getInnerText(fixed, ktTag).slice(0, 50) || "Interactive content";
        // Step 3: Inject aria-label if not present (unconditional — always needed)
        if (!/\baria-label=/i.test(fixed)) {
            fixed = fixed.replace(/^(<[a-z][a-z0-9]*\b)/i, `$1 aria-label="${ktInnerText}"`);
        }
        // Step 4: Inject tabindex="0" if not present.
        // v24: Guard — skip tabindex="0" injection when element has a button-class signal.
        // Mirrors v23 Change 3 (Step 5 role guard) — same rationale applied to tabindex.
        // Elements with fake-btn, btn, button, cta, action-btn, action-cta will be converted
        // to native <button> by semantic-button. Native <button> is focusable by default —
        // tabindex="0" is redundant noise. When Gemini handles semantic-button conversion,
        // it faithfully preserves all attributes including tabindex="0" from the div.
        // The post-Gemini cleanup does not strip tabindex="0" — so preventing injection here
        // is the correct upstream fix.
        const ktTabClassVal = (fixed.match(/\bclass=["']([^"']*)["']/i) ?? [])[1] ?? "";
        const ktTabHasButtonSignal = /\b(fake-btn|fake-button|action-btn|action-cta|btn|cta)\b/i.test(ktTabClassVal);
        if (!/\btabindex=/i.test(fixed) && !ktTabHasButtonSignal) {
            fixed = fixed.replace(/^(<[a-z][a-z0-9]*\b)/i, `$1 tabindex="0"`);
        }
        // Step 5: Inject role="button" if no role present.
        // v23: Guard — skip role="button" injection when element has a button-class signal.
        // Elements with fake-btn, btn, button, cta, action-btn, action-cta will be converted
        // to native <button> by the semantic-button fix that runs after keyboard-trap.
        // Injecting role="button" on these causes <button role="button"> in the output —
        // redundant, axe-flagged, and undetectable by SYNTHETIC 5 (which runs at scan time
        // before any fix session begins, so it can't see post-fix regressions).
        // Non-fake-btn containers (e.g. <div class="modal-overlay">) still get role="button"
        // injected — correct, those are genuine keyboard-trap elements that stay as divs.
        const ktClassVal = (fixed.match(/\bclass=["']([^"']*)["']/i) ?? [])[1] ?? "";
        const ktHasButtonConversionSignal = /\b(fake-btn|fake-button|action-btn|action-cta|btn|cta)\b/i.test(ktClassVal);
        if (!/\brole=/i.test(fixed) && !ktHasButtonConversionSignal) {
            fixed = fixed.replace(/^(<[a-z][a-z0-9]*\b)/i, `$1 role="button"`);
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
                // Expanded signal detection across class, id, inner text, and geometry.
                // border-radius:50% identifies a circular div as a radio even when no
                // class/id/text signals exist (purely visual geometric form controls).
                const isRadio = /\bradio\b/i.test(fixed) ||
                    /border-radius\s*:\s*50%/i.test(fixed);
                const role = isRadio ? "radio" : "checkbox";
                fixed = fixed.replace(
                    /^(<(?:div|span)\b[^>]*)(\/?>)/i,
                    `$1 role="${role}" aria-checked="false" tabindex="0"$2`
                );
            }
            break;
        }
        case "new-tab-warning":
            fixed = fixed.replace(/^(<a\b[^>]*)>([\s\S]*?)<\/a>/i, (_: string, open: string, inner: string) => {
                const linkText = inner.replace(/<[^>]+>/g, '').trim();
                if (/aria-label=/i.test(open))
                    return open.replace(/aria-label=["']([^"']*)["']/i,
                        (_2: string, v: string) => `aria-label="${v} (opens in new tab)"`) + `>${inner}</a>`;
                const label = linkText ? `${linkText} (opens in new tab)` : "Link (opens in new tab)";
                return `${open} aria-label="${label}">${inner}</a>`;
            });
            break;
        case "css-class-contrast": {
            // v20.1: Rewritten to match new scanner output format (Change 3 Part A).
            // Input `fixed` is now a full <style>...</style> block (not a bare #hex token).
            // Rewrites every low-contrast color: hex value inside the block to #1a1a1a.
            // Negative lookbehind prevents touching background-color, border-color, etc.
            // YIQ threshold > 180 matches detectCssClassContrast scanner exactly.
            fixed = fixed.replace(
                /(?<![a-z-])(color\s*:\s*)(#([0-9a-fA-F]{3,6}))\s*([;}"'])/gi,
                (match: string, prop: string, _hex: string, hexVal: string, terminator: string) => {
                    const full = hexVal.length === 3 ? hexVal.split('').map((c: string) => c + c).join('') : hexVal;
                    const r = parseInt(full.slice(0, 2), 16);
                    const g = parseInt(full.slice(2, 4), 16);
                    const b = parseInt(full.slice(4, 6), 16);
                    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                    // v21: Threshold corrected from 180 → 128 to match scanner in best-practices/route.ts.
                    // Catches #aaaaaa (170), #999 (153), #888 (136). Skips #767676 (118 — WCAG AA passing).
                    return brightness > 128 ? `${prop}#1a1a1a${terminator}` : match;
                }
            );
            break;
        }

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
                // v19: Post-Gemini cleanup — strip redundant role="button" and normalize aria-pressed on <button> elements
                const cleanedNormalized = (() => {
                    let c = normalizedFixed.replace(/\s*\brole=["']button["']/gi, "");
                    if (/\baria-pressed=/i.test(c)) {
                        const isToggle = /\b(aria-expanded|aria-controls)\s*=/i.test(c) ||
                            /\b(toggle|switch|expand|collapse|mute)\b/i.test(c);
                        c = isToggle
                            ? c.replace(/\baria-pressed=["'][^"']*["']/g, 'aria-pressed="false"')
                            : c.replace(/\s*\baria-pressed=["'][^"']*["']/g, "");
                    }
                    return c;
                })();
                return {
                    original,
                    fixed: cleanedNormalized,
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

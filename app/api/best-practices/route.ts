import { NextRequest, NextResponse } from "next/server";
import type { BestPracticeViolation, BestPracticesResponse } from "@/lib/best-practices-types";

// ─── HELPERS ────────────────────────────────────────────────────────────────

function getInnerText(html: string, tag: string): string {
    const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
}

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
    if (type && !["hidden", "submit", "reset", "button", "image"].includes(type)) {
        return type.charAt(0).toUpperCase() + type.slice(1) + " field";
    }
    return "Input field";
}

function buildSelector(html: string): string {
    const tagMatch = html.match(/^<(\w+)/i);
    const tag = tagMatch?.[1]?.toLowerCase() ?? "element";
    const id = html.match(/\bid=["']([^"']+)["']/i)?.[1];
    if (id) return `${tag}#${id}`;
    const cls = html.match(/\bclass=["']([^"']+)["']/i)?.[1]?.split(/\s+/)[0];
    if (cls) return `${tag}.${cls}`;
    const name = html.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (name) return `${tag}[name="${name}"]`;
    return tag;
}

// ─── SCANNER RULES ──────────────────────────────────────────────────────────

function detectSemanticButton(html: string): BestPracticeViolation | null {
    const violations: { html: string; selector: string; fix: string }[] = [];

    // <a> with button-like behavior and no real navigation href
    const anchorPattern = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
    for (const match of html.matchAll(anchorPattern)) {
        const el = match[0];
        const hasButtonSignal =
            /\b(data-af-onclick|onclick)\s*=/i.test(el) ||
            /\brole=["']button["']/i.test(el) ||
            /\bclass=["'][^"']*\b(btn|button|cta|action)\b[^"']*["']/i.test(el);

        if (!hasButtonSignal) continue;

        const href = el.match(/\bhref=["']([^"']*)["']/i)?.[1] ?? "";
        const isNavigational = href && href !== "#" && !href.startsWith("javascript:") && href.trim() !== "";
        if (isNavigational) continue;

        const innerHtmlA = getInnerHtml(el, "a");
        const classMatch = el.match(/\bclass=["']([^"']*)["']/i);
        const classAttr = classMatch ? ` class="${classMatch[1]}"` : "";
        const events = [...el.matchAll(/data-af-on\w+=["'][^"']*["']/gi)].map((m) => m[0]).join(" ");
        const fix = `<button${classAttr}${events ? " " + events : ""}>${innerHtmlA}</button>`;

        violations.push({ html: el, selector: buildSelector(el), fix });
    }

    // v17: Replaced catastrophically-backtracking [\s\S]*? block and inner-pass regexes
    // with O(n) opening-tag scan + depth-counter element extraction.
    //
    // Old approach: blockPattern /<(div|span|li|p)\b[^>]*>[\s\S]*?<\/\1>/gi
    // Problem: outer container divs (product-card, section) consumed inner fake-btn elements
    // before the loop could process them. The 50KB guard helped on very large pages but did
    // nothing for test.html (16KB) where the issue was nesting consumption, not file size.
    //
    // New approach:
    // Pass 1 — scan ALL opening tags O(n) for button signals (class, role, onclick, type).
    // Pass 2 — for each hit, depth-count-walk to extract the full element.
    // Pass 3 — deduplicate: if a smaller element is already captured inside a larger one,
    //           prefer the smaller (more precise) element for the fix.
    //
    // This correctly handles:
    // - <div class="fake-btn" data-af-onclick="..."> (class signal only)
    // - <div role="button" data-af-onclick="..."> (role signal)
    // - <div class="fake-btn" style="..."> inside <div class="product-card"> (nested)
    // - Any page size — no 50KB guard needed
    const blockOpenTagRegex = /<(div|span|li|p)\b([^>]*)>/gi;
    let blockCount = 0;
    let blockOpenMatch: RegExpExecArray | null;
    while ((blockOpenMatch = blockOpenTagRegex.exec(html)) !== null && blockCount < 15) {
        const tag = blockOpenMatch[1].toLowerCase();
        const attrs = blockOpenMatch[2];
        const openTag = blockOpenMatch[0];
        const openTagStart = blockOpenMatch.index;
        const classVal = attrs.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? "";
        // P6: Skip elements already partially fixed (role=button + tabindex=0 + no onclick)
        if (
            /\brole=["']button["']/i.test(openTag) &&
            /\btabindex=["']0["']/i.test(openTag) &&
            !/\b(data-af-onclick|onclick)\s*=/i.test(openTag)
        ) continue;
        const hasButtonSignal =
            /\brole=["']button["']/i.test(openTag) ||
            /\b(data-af-onclick|onclick)\s*=/i.test(openTag) ||
            /\btype=["']button["']/i.test(openTag) ||
            /\brole=["']application["']/i.test(openTag) ||
            /\b(btn|button|cta|fake-btn|action-btn|action-cta)\b/i.test(classVal);
        if (!hasButtonSignal) continue;
        // Depth-counter walk to extract the full element
        let depth = 1;
        let pos = openTagStart + openTag.length;
        const closeTagRe = new RegExp(`<(${tag})\\b[^>]*>|<\\/${tag}>`, 'gi');
        closeTagRe.lastIndex = pos;
        let closeEnd = pos;
        let depthWalkMatch: RegExpExecArray | null;
        while (depth > 0 && (depthWalkMatch = closeTagRe.exec(html)) !== null) {
            if (depthWalkMatch[1]) {
                depth++;
            } else {
                depth--;
                if (depth === 0) closeEnd = depthWalkMatch.index + depthWalkMatch[0].length;
            }
        }
        if (depth !== 0) continue; // malformed HTML — skip safely
        const el = html.slice(openTagStart, closeEnd);
        // Skip if a more-specific inner element covering the same range is already captured.
        // This prevents the product-card wrapper from shadowing the fake-btn inside it.
        const alreadyCaptured = violations.some(v => v.html === el || el.includes(v.html));
        if (alreadyCaptured) continue;
        // Also skip structural wrapper containers — we want the INNER button, not the card.
        const isStructuralWrapper = /\b(card|wrapper|container|product|item|panel|tile|box|section|grid|row|col)\b/i.test(classVal) &&
            !/\b(btn|button|cta|fake-btn|action-btn|action-cta)\b/i.test(classVal) &&
            !/\b(data-af-onclick|onclick)\s*=/i.test(openTag);
        if (isStructuralWrapper) continue;
        const innerHtmlB = getInnerHtml(el, tag);
        const events = [...el.matchAll(/data-af-on\w+=["'][^"']*["']/gi)].map((m) => m[0]).join(" ");
        const classMatch = el.match(/\bclass=["']([^"']*)["']/i);
        const classAttr = classMatch ? ` class="${classMatch[1]}"` : "";
        const idMatch = el.match(/\bid=["']([^"']*)["']/i);
        const idAttr = idMatch ? ` id="${idMatch[1]}"` : "";
        const styleMatch = el.match(/\bstyle=["']([^"']*)["']/i);
        const styleAttr = styleMatch ? ` style="${styleMatch[1]}"` : "";
        const fix = `<button${idAttr}${classAttr}${styleAttr}${events ? " " + events : ""}>${innerHtmlB}</button>`;
        violations.push({ html: el, selector: buildSelector(openTag), fix });
        blockCount++;
    }
    // v17: Inner pass removed — the new O(n) opening-tag scan above already reaches
    // inner elements directly without being blocked by outer container consumption.
    // The alreadyCaptured guard above prevents double-flagging of the same element.

    if (violations.length === 0) return null;
    return {
        id: "semantic-button",
        category: "motor",
        severity: "serious",
        title: "Interactive element should be a native <button>",
        description: "Motor disability users using switch access or voice control cannot reliably activate non-button elements. Native <button> gets keyboard Space/Enter free; this element does not.",
        wcagRef: "WCAG 2.1 — 4.1.2 Name, Role, Value",
        nodes: violations.slice(0, 30),
    };
}

function detectPersistentLabel(html: string): BestPracticeViolation | null {
    const violations: { html: string; selector: string; fix: string }[] = [];

    // Match <input>, <select>, <textarea> tags
    const formControlPattern = /<(input|select|textarea)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>|>)/gi;
    for (const match of html.matchAll(formControlPattern)) {
        const el = match[0];
        const tag = match[1].toLowerCase();

        // Skip hidden/submit/reset/button/image inputs
        if (tag === "input") {
            const type = el.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "text";
            if (["hidden", "submit", "reset", "button", "image"].includes(type)) continue;
        }

        // Skip if already has aria-label or aria-labelledby
        if (/aria-label=/i.test(el) || /aria-labelledby=/i.test(el)) continue;

        // Check if there's a wrapping <label> — look for <label> containing this element's id
        const elId = el.match(/\bid=["']([^"']+)["']/i)?.[1];
        if (elId) {
            // Check for <label for="id"> pattern
            const labelForPattern = new RegExp(`<label\\b[^>]*\\bfor=["']${elId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i");
            if (labelForPattern.test(html)) continue;
        }

        // Check if wrapped inside <label>
        const elIndex = html.indexOf(el);
        if (elIndex > -1) {
            const before = html.slice(Math.max(0, elIndex - 500), elIndex);
            const after = html.slice(elIndex + el.length, elIndex + el.length + 500);
            if (/<label\b[^>]*>[^]*$/i.test(before) && /^[^]*<\/label>/i.test(after)) continue;
        }

        const label = inferLabel(el);
        const fix = el.replace(new RegExp(`<${tag}\\b`, "i"), `<${tag} aria-label="${label}" `);

        violations.push({ html: el, selector: buildSelector(el), fix });
    }

    if (violations.length === 0) return null;
    return {
        id: "persistent-label",
        category: "cognitive",
        severity: "moderate",
        title: "Form control lacks a persistent accessible label",
        description: "placeholder disappears on input — cognitive disability users lose context mid-entry. aria-label persists throughout and is announced by screen readers on focus.",
        wcagRef: "WCAG 2.1 — 3.3.2 Labels or Instructions",
        nodes: violations.slice(0, 20),
    };
}

function detectKeyboardTrap(html: string): BestPracticeViolation | null {
    const violations: { html: string; selector: string; fix: string }[] = [];
    // v17: Replaced catastrophically-backtracking [\s\S]*? container regex with O(n)
    // opening-tag-only scan + position-aware element extraction.
    // The old /<(div|...)\b[^>]*>[\s\S]*?<\/\1>/gi was O(n²) on large pages and
    // silently returned zero matches when the trap div appeared after significant markup.
    // New approach:
    // Pass 1 — scan only opening tags (no nested content) for keyboard trap signals.
    //           This is O(n) and never backtracks.
    // Pass 2 — for each match, extract the full element using a depth counter walk
    //           starting from the match position. Also O(n).
    const openTagRegex = /<(div|section|article|aside)\b([^>]*)>/gi;
    let openMatch: RegExpExecArray | null;
    while ((openMatch = openTagRegex.exec(html)) !== null) {
        const tag = openMatch[1].toLowerCase();
        const attrs = openMatch[2];
        const openTag = openMatch[0];
        const openTagStart = openMatch.index;
        const hasClick = /\b(data-af-onclick|onclick)\s*=/i.test(openTag);
        const hasKeydownTrap = /data-af-onkeydown=["'][^"']*preventDefault[^"']*["']/i.test(openTag);
        if (!hasClick && !hasKeydownTrap) continue;
        const hasTabindex = /\btabindex=/i.test(openTag);
        const hasRole = /\brole=/i.test(openTag);
        // A keydown trap is dangerous even on a focusable element — never skip it.
        if (!hasKeydownTrap && (hasTabindex || hasRole)) continue;
        // Pass 2: depth-counter walk to find the matching closing tag.
        // We scan forward from the end of the opening tag, counting open/close pairs.
        let depth = 1;
        let pos = openTagStart + openTag.length;
        const closeTagRe = new RegExp(`<(${tag})\\b[^>]*>|<\\/${tag}>`, 'gi');
        closeTagRe.lastIndex = pos;
        let closeEnd = pos;
        let depthMatch: RegExpExecArray | null;
        while (depth > 0 && (depthMatch = closeTagRe.exec(html)) !== null) {
            if (depthMatch[1]) {
                // Another opening tag of same type — go deeper
                depth++;
            } else {
                // Closing tag
                depth--;
                if (depth === 0) closeEnd = depthMatch.index + depthMatch[0].length;
            }
        }
        // If depth never reached 0, the element is malformed — skip safely
        if (depth !== 0) continue;
        const el = html.slice(openTagStart, closeEnd);
        const innerText = getInnerText(el, tag).slice(0, 50) || "Interactive content";
        const ariaLabel = `aria-label="${innerText}"`;
        // Strip the preventDefault trap in the pre-computed fix node so the scanner's
        // suggested fix is already clean when shown in the DiffViewer.
        const elWithoutTrap = el.replace(/\s*data-af-onkeydown=["'][^"']*preventDefault[^"']*["']/gi, "");
        const fix = elWithoutTrap.replace(
            new RegExp(`^<${tag}\\b`, "i"),
            `<${tag} tabindex="0" role="button" ${ariaLabel}`
        );
        violations.push({ html: el, selector: buildSelector(openTag), fix });
    }

    if (violations.length === 0) return null;
    return {
        id: "keyboard-trap",
        category: "motor",
        severity: "serious",
        title: "Clickable container is unreachable by keyboard",
        description: "Keyboard and switch-access users cannot focus or activate this element.",
        wcagRef: "WCAG 2.1 — 2.1.1 Keyboard",
        nodes: violations.slice(0, 20),
    };
}

function detectFocusIndicator(html: string): BestPracticeViolation | null {
    const violations: { html: string; selector: string; fix: string }[] = [];

    // Match elements with style attributes containing outline:none or outline:0
    const outlinePattern = /<[a-z]\w*\b[^>]*style=["'][^"']*outline\s*:\s*(none|0(?:px)?)\b[^"']*["'][^>]*(?:\/>|>[\s\S]*?<\/[a-z]\w*>|>)/gi;
    for (const match of html.matchAll(outlinePattern)) {
        const el = match[0];
        const fix = el.replace(
            /outline\s*:\s*(none|0(?:px)?)/gi,
            "outline:2px solid #005fcc;outline-offset:2px"
        );
        violations.push({ html: el, selector: buildSelector(el), fix });
    }

    // Also match inline <style> blocks with :focus{outline:none}
    const styleBlockPattern = /<style\b[^>]*>[^]*?:focus\s*\{[^}]*outline\s*:\s*(none|0(?:px)?)[^}]*\}[^]*?<\/style>/gi;
    for (const match of html.matchAll(styleBlockPattern)) {
        const el = match[0];
        const fix = el.replace(
            /outline\s*:\s*(none|0(?:px)?)/gi,
            "outline:2px solid #005fcc;outline-offset:2px"
        );
        violations.push({ html: el, selector: "style:focus-rule", fix });
    }

    if (violations.length === 0) return null;
    return {
        id: "focus-indicator",
        category: "motor",
        severity: "moderate",
        title: "Focus indicator suppressed",
        description: "Keyboard users cannot see which element is focused. Never use outline:none without providing a custom :focus-visible style.",
        wcagRef: "WCAG 2.1 — 2.4.7 Focus Visible",
        nodes: violations.slice(0, 20),
    };
}

function detectNegativeTabindex(html: string): BestPracticeViolation | null {
    const violations: { html: string; selector: string; fix: string }[] = [];
    const negTabRegex = /<a\b[^>]*\btabindex=["']-1["'][^>]*>/gi;
    let negMatch: RegExpExecArray | null;
    while ((negMatch = negTabRegex.exec(html)) !== null) {
        const el = negMatch[0];
        violations.push({
            html: el,
            selector: "a[tabindex='-1']",
            fix: el.replace(/\s*tabindex=["']-1["']/gi, "")
        });
    }
    if (violations.length === 0) return null;
    return {
        id: "negative-tabindex",
        category: "motor",
        severity: "serious",
        title: "Link removed from keyboard tab order",
        description: "tabindex='-1' makes this link unreachable by keyboard and switch-access navigation. Remove tabindex or use tabindex='0' if programmatic focus management is needed.",
        wcagRef: "WCAG 2.1 — 2.1.1 Keyboard",
        nodes: violations.slice(0, 10),
    };
}

function detectFakeFormControl(html: string): BestPracticeViolation | null {
    const violations: { html: string; selector: string; fix: string }[] = [];

    // P8: Geometric pre-pass — finds small interactive divs/spans that are nested inside
    // wrapper elements and would be consumed by the outer fakeControlRegex match.
    // Targets: width 10-30px, height 10-30px, cursor:pointer, onclick/data-af-onclick, empty content.
    // Runs BEFORE fakeControlRegex so inner elements are flagged before the outer wrapper hides them.
    const geometricPrePassRegex = /<(div|span)\b([^>]*)><\/\1>/gi;
    let gpCount = 0;
    let gpMatch: RegExpExecArray | null;
    while ((gpMatch = geometricPrePassRegex.exec(html)) !== null && gpCount < 10) {
        const tag = gpMatch[1];
        const attrs = gpMatch[2];
        const openTag = `<${tag}${attrs}>`;
        const fullEl = gpMatch[0];

        if (/aria-expanded/i.test(attrs) || /\brole=/i.test(attrs)) continue;

        const style = attrs.match(/\bstyle=["']([^"']*)["']/i)?.[1] ?? "";
        const hasPointer = /cursor\s*:\s*pointer/i.test(style);
        const hasOnclick = /\b(data-af-onclick|onclick)\s*=/i.test(openTag);
        const widthMatch = style.match(/\bwidth\s*:\s*(\d+)px/i);
        const heightMatch = style.match(/\bheight\s*:\s*(\d+)px/i);
        const w = widthMatch ? parseInt(widthMatch[1]) : 0;
        const h = heightMatch ? parseInt(heightMatch[1]) : 0;
        const isSmall = w >= 10 && w <= 30 && h >= 10 && h <= 30;

        if (!hasPointer || !hasOnclick || !isSmall) continue;

        const isCircle = /border-radius\s*:\s*50%/i.test(style);
        const fixedRole = isCircle ? "radio" : "checkbox";
        violations.push({
            html: fullEl,
            selector: buildSelector(openTag),
            fix: openTag.replace(/^(<(?:div|span)\b[^>]*)>/i,
                `$1 role="${fixedRole}" aria-checked="false" tabindex="0">`) + `</${tag}>`
        });
        gpCount++;
    }

    // Match full tag block so we can search inner text signatures if needed
    const fakeControlRegex = /<(div|span)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let fcMatch: RegExpExecArray | null;
    let fcCount = 0;
    while ((fcMatch = fakeControlRegex.exec(html)) !== null && fcCount < 5) {
        const tag = fcMatch[1];
        const attrs = fcMatch[2];
        const innerText = fcMatch[3].replace(/<[^>]+>/g, '').toLowerCase().trim();
        const openTag = `<${tag}${attrs}>`;

        // P16: Narrowed accordion guard — only skip aria-expanded when it signals a genuine
        // accordion toggle (has aria-controls or toggle/expand class). Pure fake form controls
        // may also have aria-expanded from sloppy markup and should still be flagged.
        const isAccordionSignal = /aria-expanded/i.test(attrs) && (
            /aria-controls/i.test(attrs) ||
            /\b(toggle|expand|collapse|accordion)\b/i.test(attrs.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? "")
        );
        if (isAccordionSignal || /\brole=/i.test(attrs)) continue;

        const classMatch = attrs.match(/\bclass=["']([^"']*)["']/i);
        const cls = classMatch?.[1] ?? "";
        const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
        const idVal = idMatch?.[1] ?? "";

        // Skip structural packaging/wrapping labels
        if (/\blabel\b/i.test(cls) || /\blabel\b/i.test(idVal)) continue;

        // Expanded signal checks across classes, IDs, and element inner context
        const isRadio = /radio/i.test(cls) || /radio/i.test(idVal) || /radio/i.test(innerText);
        const isCheckbox = /checkbox/i.test(cls) || /checkbox/i.test(idVal) || /checkbox/i.test(innerText);
        const isToggle = /toggle/i.test(cls) || /toggle/i.test(idVal) || /switch/i.test(cls) || /switch/i.test(idVal);

        if (isRadio || isCheckbox || isToggle) {
            // Determine appropriate role fallback matching the framework intent
            const fixedRole = isRadio ? "radio" : (isToggle ? "switch" : "checkbox");
            violations.push({
                html: fcMatch[0],
                selector: buildSelector(openTag),
                fix: openTag.replace(/^(<(?:div|span)\b[^>]*)>/i,
                    `$1 role="${fixedRole}" aria-checked="false" tabindex="0">`) + `${fcMatch[3]}</${tag}>`
            });
            fcCount++;
        } else {
            // Geometric heuristic: purely visual form controls with no class/id/text signals.
            // Matches small square (checkbox) or circle (radio) divs with cursor:pointer + onclick.
            const style = attrs.match(/\bstyle=["']([^"']*)["']/i)?.[1] ?? "";
            const hasPointer = /cursor\s*:\s*pointer/i.test(style);
            const hasOnclick = /\b(data-af-onclick|onclick)\s*=/i.test(openTag);
            const widthMatch = style.match(/\bwidth\s*:\s*(\d+)px/i);
            const heightMatch = style.match(/\bheight\s*:\s*(\d+)px/i);
            const w = widthMatch ? parseInt(widthMatch[1]) : 0;
            const h = heightMatch ? parseInt(heightMatch[1]) : 0;
            const isSmall = w >= 10 && w <= 30 && h >= 10 && h <= 30;
            // P8b: Also treat purely-whitespace inner content as empty (e.g. "  " between tags)
            const isEmptyContent = innerText.replace(/\s/g, "").length === 0;
            if (hasPointer && hasOnclick && isSmall && isEmptyContent) {
                const isCircle = /border-radius\s*:\s*50%/i.test(style);
                const fixedRole = isCircle ? "radio" : "checkbox";
                violations.push({
                    html: fcMatch[0],
                    selector: buildSelector(openTag),
                    fix: openTag.replace(/^(<(?:div|span)\b[^>]*)>/i,
                        `$1 role="${fixedRole}" aria-checked="false" tabindex="0">`) + `${fcMatch[3]}</${tag}>`
                });
                fcCount++;
            }
        }
    }
    if (violations.length === 0) return null;
    return {
        id: "fake-form-control",
        category: "screen-reader",
        severity: "serious",
        title: "Fake form control missing semantic role",
        description: "This element visually mimics a form control but has no semantic role. Screen readers cannot identify it as interactive. Add the correct ARIA role and aria-checked.",
        wcagRef: "WCAG 2.1 — 4.1.2 Name, Role, Value",
        nodes: violations.slice(0, 5),
    };
}

function detectNewTabWarning(html: string): BestPracticeViolation | null {
    const violations: { html: string; selector: string; fix: string }[] = [];
    // Match full <a>...</a> so inner text is available for a meaningful aria-label.
    const newTabRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let ntMatch: RegExpExecArray | null;
    let ntCount = 0;
    while ((ntMatch = newTabRegex.exec(html)) !== null && ntCount < 5) {
        const attrs = ntMatch[1];
        if (!/\btarget=["']_blank["']/i.test(attrs)) continue;
        const ariaLabel = attrs.match(/aria-label=["']([^"']*)["']/i)?.[1] ?? "";
        if (/new.?tab|new.?window/i.test(ariaLabel)) continue;
        const el = ntMatch[0];           // full <a>...</a>
        const inner = ntMatch[2];        // inner HTML content
        const linkText = inner.replace(/<[^>]+>/g, '').trim();
        const fix = el.replace(/^(<a\b[^>]*)>([\s\S]*?)<\/a>/i, (_: string, open: string, innerContent: string) => {
            if (/aria-label=/i.test(open))
                return open.replace(/aria-label=["']([^"']*)["']/i,
                    (_2: string, v: string) => `aria-label="${v} (opens in new tab)"`) + `>${innerContent}</a>`;
            const label = linkText ? `${linkText} (opens in new tab)` : "Link (opens in new tab)";
            return `${open} aria-label="${label}">${innerContent}</a>`;
        });

        violations.push({ html: el, selector: "a[target=_blank]", fix });
        ntCount++;
    }
    if (violations.length === 0) return null;
    return {
        id: "new-tab-warning",
        category: "cognitive",
        severity: "moderate",
        title: "Link opens in new tab without warning",
        description: "Opening a new tab without notice disorients screen reader and cognitive disability users who don't expect context to change.",
        wcagRef: "WCAG 2.1 — 3.2.2 On Input",
        nodes: violations.slice(0, 5),
    };
}

function detectCssClassContrast(html: string): BestPracticeViolation | null {
    // v20.1: Complete rewrite. Old implementation scanned ALL hex tokens globally —
    // raised phantom violations for link blues, dark text, border grays, everything.
    // The violation html field was a bare "#hex" string — heal route could never locate it.
    //
    // New implementation:
    // 1. Finds only <style> blocks (not inline styles — those are covered by SYNTHETIC 6).
    // 2. Inside each block, finds only `color:` property values (not background-color, border-color).
    //    Negative lookbehind (?<![a-z-]) prevents matching background-color, text-decoration-color, etc.
    // 3. Returns the FULL <style> block as the violation node — heal route replaces the CSS rule.
    // 4. Pre-computes the fixed CSS in the `fix` field — offline heal can apply it without re-parsing.
    const violations: { html: string; selector: string; fix: string }[] = [];
    const styleBlockRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    let styleMatch: RegExpExecArray | null;
    while ((styleMatch = styleBlockRegex.exec(html)) !== null) {
        const fullBlock = styleMatch[0];
        const cssContent = styleMatch[1];
        // color: #hex only — negative lookbehind excludes background-color:, border-color:, etc.
        const colorPropRegex = /(?<![a-z-])color\s*:\s*(#([0-9a-fA-F]{3,6}))\s*[;}"']/gi;
        let colorMatch: RegExpExecArray | null;
        let hasLowContrast = false;
        let fixedCss = cssContent;
        while ((colorMatch = colorPropRegex.exec(cssContent)) !== null) {
            const hexRaw = colorMatch[2];
            const hex = hexRaw.length === 3 ? hexRaw.split('').map(c => c + c).join('') : hexRaw;
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            // YIQ brightness — same formula used across heal/route.ts (pickContrastTextColor).
            // v21: Threshold corrected from 180 → 128.
            // #aaaaaa brightness=170: caught at >128 ✓, was missed at >180 ✗ (confirmed Bug 1).
            // #999999 brightness=153: caught at >128 ✓, was missed at >180 ✗.
            // #767676 brightness=118: WCAG AA passing (4.54:1) — correctly skipped at >128 ✓.
            // 128 matches pickContrastTextColor threshold in heal/route.ts — consistent across codebase.
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            if (brightness > 128) {
                hasLowContrast = true;
                fixedCss = fixedCss.replace(
                    new RegExp(
                        `((?<![a-z-])color\\s*:\\s*)${colorMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
                        'gi'
                    ),
                    `$1#1a1a1a`
                );
            }
        }
        if (hasLowContrast) {
            violations.push({
                html: fullBlock,
                selector: "style:color-rule",
                fix: fullBlock.replace(cssContent, fixedCss),
            });
        }
    }
    if (violations.length === 0) return null;
    return {
        id: "css-class-contrast",
        category: "cognitive",
        severity: "serious",
        title: "CSS class rule sets low-contrast text color",
        description: "A CSS class in the <style> block defines a text color that fails WCAG AA 4.5:1 contrast ratio on white. Fixing the CSS source corrects all elements using this class.",
        wcagRef: "WCAG 2.1 — 1.4.3 Contrast (Minimum)",
        nodes: violations.slice(0, 5),
    };
}

// ─── ROUTE HANDLER ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    let body: { html?: string; url?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { html, url } = body;
    if (!html) {
        return NextResponse.json({ error: "Missing 'html' field" }, { status: 400 });
    }

    const violations: BestPracticeViolation[] = [];

    // Use let so we can reassign for deduplication
    let semanticButton = detectSemanticButton(html);
    if (semanticButton) violations.push(semanticButton);

    const persistentLabel = detectPersistentLabel(html);
    if (persistentLabel) violations.push(persistentLabel);

    const keyboardTrap = detectKeyboardTrap(html);
    if (keyboardTrap) violations.push(keyboardTrap);

    const focusIndicator = detectFocusIndicator(html);
    if (focusIndicator) violations.push(focusIndicator);

    const negativeTabindex = detectNegativeTabindex(html);
    if (negativeTabindex) violations.push(negativeTabindex);

    // P2: Deduplicate — fake-form-control should not re-flag nodes already in semantic-button
    const semanticButtonHtmls = new Set((semanticButton?.nodes ?? []).map(n => n.html));
    let fakeFormControl = detectFakeFormControl(html);
    if (fakeFormControl) {
        fakeFormControl = {
            ...fakeFormControl,
            nodes: fakeFormControl.nodes.filter(n => !semanticButtonHtmls.has(n.html))
        };
        if (fakeFormControl.nodes.length > 0) violations.push(fakeFormControl);
    }

    const newTabWarning = detectNewTabWarning(html);
    if (newTabWarning) violations.push(newTabWarning);

    const cssClassContrast = detectCssClassContrast(html);
    if (cssClassContrast) violations.push(cssClassContrast);

    const response: BestPracticesResponse = {
        violations,
        timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
}

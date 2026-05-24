import { NextRequest, NextResponse } from "next/server";
import type { BestPracticeViolation, BestPracticesResponse } from "@/lib/best-practices-types";

// ─── HELPERS ────────────────────────────────────────────────────────────────

function getInnerText(html: string, tag: string): string {
    const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
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

        const inner = getInnerText(el, "a");
        const classMatch = el.match(/\bclass=["']([^"']*)["']/i);
        const classAttr = classMatch ? ` class="${classMatch[1]}"` : "";
        const events = [...el.matchAll(/data-af-on\w+=["'][^"']*["']/gi)].map((m) => m[0]).join(" ");
        const fix = `<button${classAttr}${events ? " " + events : ""}>${inner}</button>`;

        violations.push({ html: el, selector: buildSelector(el), fix });
    }

    // <div|span|li|p> with role="button", onclick, btn/cta class, type="button", or role="application"
    const blockPattern = /<(div|span|li|p)\b[^>]*>[\s\S]*?<\/\1>/gi;
    let blockCount = 0;
    for (const match of html.matchAll(blockPattern)) {
        if (blockCount >= 5) break;
        const el = match[0];
        const openTag = el.match(/^<[^>]+>/)?.[0] ?? "";
        const classVal = openTag.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? "";

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
            /(?:^|\s)(btn|button|cta)(?:\s|$)/i.test(classVal);
        if (!hasButtonSignal) continue;

        const tag = match[1].toLowerCase();
        const inner = getInnerText(el, tag);
        const events = [...el.matchAll(/data-af-on\w+=["'][^"']*["']/gi)].map((m) => m[0]).join(" ");
        const classMatch = el.match(/\bclass=["']([^"']*)["']/i);
        const classAttr = classMatch ? ` class="${classMatch[1]}"` : "";
        const fix = `<button${classAttr}${events ? " " + events : ""}>${inner}</button>`;

        violations.push({ html: el, selector: buildSelector(el), fix });
        blockCount++;
    }

    if (violations.length === 0) return null;
    return {
        id: "semantic-button",
        category: "motor",
        severity: "serious",
        title: "Interactive element should be a native <button>",
        description: "Motor disability users using switch access or voice control cannot reliably activate non-button elements. Native <button> gets keyboard Space/Enter free; this element does not.",
        wcagRef: "WCAG 2.1 — 4.1.2 Name, Role, Value",
        nodes: violations.slice(0, 20),
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

    const containerPattern = /<(div|section|article|aside)\b[^>]*>[\s\S]*?<\/\1>/gi;
    for (const match of html.matchAll(containerPattern)) {
        const el = match[0];
        // Only match the opening tag to check attributes
        const openTag = el.match(/^<[^>]+>/)?.[0] ?? "";

        const hasClick = /\b(data-af-onclick|onclick)\s*=/i.test(openTag);
        if (!hasClick) continue;

        const hasTabindex = /\btabindex=/i.test(openTag);
        const hasRole = /\brole=/i.test(openTag);
        if (hasTabindex || hasRole) continue;

        const tag = match[1].toLowerCase();
        const innerText = getInnerText(el, tag).slice(0, 50) || "Interactive content";
        const ariaLabel = `aria-label="${innerText}"`;
        const fix = el.replace(
            new RegExp(`^<${tag}\\b`, "i"),
            `<${tag} tabindex="0" role="button" ${ariaLabel}`
        );

        violations.push({ html: el, selector: buildSelector(el), fix });
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
    const fakeControlRegex = /<(?:div|span)\b([^>]*)>/gi;
    let fcMatch: RegExpExecArray | null;
    let fcCount = 0;
    while ((fcMatch = fakeControlRegex.exec(html)) !== null && fcCount < 5) {
        const attrs = fcMatch[1];
        // P1: Skip accordion toggles — aria-expanded signals an expander, not a form control
        if (/aria-expanded/i.test(attrs)) continue;
        const classMatch = attrs.match(/\bclass=["']([^"']*)["']/i);
        const cls = classMatch?.[1] ?? "";
        const hasRole = /\brole=["'](?:radio|checkbox|switch|option)["']/i.test(attrs);
        // Skip label/wrapper elements — they wrap the control, they ARE NOT the control.
        // Universal pattern: any class containing the word "label" is a container, not the input.
        if (/\blabel\b/i.test(cls)) continue;
        // Only flag radio/checkbox class names — "toggle" and "switch" are overloaded
        if (/\b(radio|checkbox)\b/i.test(cls) && !hasRole) {
            const isRadio = /radio/i.test(cls);
            const fixedRole = isRadio ? "radio" : "checkbox";
            violations.push({
                html: fcMatch[0],
                selector: `[class*="${fixedRole}"]`,
                fix: fcMatch[0].replace(/^(<(?:div|span)\b[^>]*)>/i,
                    `$1 role="${fixedRole}" aria-checked="false" tabindex="0">`)
            });
            fcCount++;
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
    const newTabRegex = /<a\b([^>]*)>/gi;
    let ntMatch: RegExpExecArray | null;
    let ntCount = 0;
    while ((ntMatch = newTabRegex.exec(html)) !== null && ntCount < 5) {
        const attrs = ntMatch[1];
        if (!/\btarget=["']_blank["']/i.test(attrs)) continue;
        const ariaLabel = attrs.match(/aria-label=["']([^"']*)["']/i)?.[1] ?? "";
        if (/new.?tab|new.?window/i.test(ariaLabel)) continue;
        const el = ntMatch[0];
        const fix = el.replace(/^(<a\b[^>]*)>/i, (_: string, open: string) => {
            if (/aria-label=/i.test(open))
                return open.replace(/aria-label=["']([^"']*)["']/i,
                    (_2: string, v: string) => `aria-label="${v} (opens in new tab)"`) + ">";
            return `${open} aria-label="Link (opens in new tab)">`;
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

    const response: BestPracticesResponse = {
        violations,
        timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
}

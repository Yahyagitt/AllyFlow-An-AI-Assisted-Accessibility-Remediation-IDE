import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AxeViolation } from "@/lib/scan-types";

export interface HealRequest {
    violation: AxeViolation;
    nodeHtml: string;
    pageContext?: {
        h1?: string;
        metaDescription?: string;
        ogTitle?: string;
        nearestText?: string; // v14: nearest product/section text for image alt context
    };
}

export interface HealResponse {
    original: string;
    fixed: string;
    strategy: "gemini" | "heuristic-fallback";
    description: string;
}

// ─── MASTER PROMPT ──────────────────────────────────────────────────────────
const MASTER_PROMPT = `You are AllyFlow's accessibility repair engine.
Given a WCAG violation ID, description, and HTML snippet, return ONLY the
corrected raw HTML. No markdown. No backticks. No explanation. No wrapper
elements unless the rule explicitly requires them. Preserve every attribute
and inner content not causing the violation.

RULE CATALOGUE — format: [rule-id] fix-instruction | before→after example

IMAGES & MEDIA
[image-alt] Add meaningful alt describing the image purpose. If decorative, use alt="". | <img src="x.jpg"> → <img src="x.jpg" alt="Team photo">
[image-alt-filename] Replace filename/path alt with a human-readable description derived from the filename. Strip path, extension, hyphens/underscores. | alt="icons/icon-pointer.svg" → alt="Pointer icon"

CRITICAL ALT TEXT RULES — read carefully:
- NEVER use the image src URL, domain name, or file path as the alt value.
- BAD: alt="images.unsplash.com"  alt="/assets/icons/icon-vision.svg"  alt="photo-abc123.jpg"
- For icons with readable filenames: derive from filename. icon-vision.svg → alt="Vision icon"
- For opaque CDN URLs (UUIDs, photo-NNN, random hashes): describe from surrounding context
  (nearby h1, h2, figcaption, aria-label of parent container, or adjacent paragraph text).
- If surrounding context gives no description and the image appears decorative (inside a
  link that has text, purely stylistic): use alt="" and add role="presentation".
- An image inside a link MUST have alt text that describes the link destination if the
  link has no other text; otherwise alt="" is correct (the link text suffices).
[image-redundant-alt] If alt duplicates adjacent visible text exactly, replace with alt="" and add role="presentation". | <img alt="Submit"> Submit → <img alt="" role="presentation"> Submit
[role-img-alt] Add aria-label describing what the image conveys. | <div role="img"> → <div role="img" aria-label="Bar chart showing Q4 revenue">
[svg-img-alt] Add <title> as first child of SVG and aria-labelledby pointing to it. | <svg role="img"> → <svg role="img" aria-labelledby="svgTitle"><title id="svgTitle">Description</title>...
[input-image-alt] Add alt attribute to input[type=image] describing its action. | <input type="image" src="go.png"> → <input type="image" src="go.png" alt="Submit form">
[object-alt] Add meaningful text content inside <object> as fallback. | <object data="x.swf"></object> → <object data="x.swf">Interactive chart — upgrade browser to view</object>
[area-alt] Add alt to <area> describing its link destination. | <area href="/about"> → <area href="/about" alt="About us page">
[video-caption] Add a <track kind="captions"> child to the video element. | <video src="x.mp4"> → <video src="x.mp4"><track kind="captions" src="x.vtt" srclang="en" label="English"></video>
[no-autoplay-audio] Remove autoplay attribute. If loop also present, remove it. | <audio autoplay loop> → <audio>

FORMS & LABELS
[label] Add aria-label derived from: placeholder > name > id > type, in that priority. | <input type="email" placeholder="Your email"> → <input type="email" placeholder="Your email" aria-label="Your email">
[label-title-only] Title attribute is not a sufficient label. Add aria-label with the same value as title. Keep title. | <input title="Search"> → <input title="Search" aria-label="Search">
[select-name] Add aria-label to the select element derived from surrounding context or name attribute. | <select name="country"> → <select name="country" aria-label="Country">
[input-button-name] Add value or aria-label to input[type=button|submit|reset]. | <input type="submit"> → <input type="submit" value="Submit">
[autocomplete-valid] Fix autocomplete attribute to a valid token from the HTML spec or remove if not applicable. | <input autocomplete="fullname"> → <input autocomplete="name">
[empty-heading] Add descriptive text content to the empty heading, or remove the heading if truly unused. | <h2></h2> → remove element entirely

BUTTONS & LINKS
[button-name] Add aria-label from inner text context, or add visible text child. | <button><svg>...</svg></button> → <button aria-label="Close dialog"><svg>...</svg></button>
[link-name] Add aria-label describing the link destination. | <a href="/about"><img src="arrow.png"></a> → <a href="/about" aria-label="About us"><img src="arrow.png"></a>
[nested-interactive] Remove the outer interactive wrapper or the inner one. If <a> wraps <button>, remove the <a> and add onclick to button. | <a href="#"><button>Click</button></a> → <button onclick="location.href='#'">Click</button>

ARIA ATTRIBUTES
[aria-allowed-attr] Remove the ARIA attribute that is not permitted on this element type. | <input aria-expanded="true"> → <input> (remove aria-expanded)
[aria-pressed] aria-pressed is ONLY valid on stateful toggle buttons.
  - Checkout, Submit, Add to Cart, navigation links → NOT toggles → REMOVE aria-pressed entirely.
  - Accordion toggles, mute/unmute, bold/italic, expand/collapse → IS a toggle → set aria-pressed="false".
  - Detection: if the button has aria-expanded, aria-controls, or its class/id contains
    "toggle"/"switch"/"expand"/"mute" → it is a toggle.
  - NEVER leave aria-pressed="true" as a static permanent value.
  - NEVER add aria-pressed to a button that didn't already have it unless it is clearly a toggle.
[aria-deprecated-role] Replace deprecated role with its current equivalent. directory→list, presentation→none. | role="directory" → role="list"
[aria-required-attr] Add the missing required ARIA attribute. For role="checkbox" add aria-checked. For role="combobox" add aria-expanded. | <div role="checkbox"> → <div role="checkbox" aria-checked="false">
[aria-required-children] Add the required child role structure inside the parent. role="list" needs role="listitem" children. | <ul role="list"></ul> → <ul role="list"><li role="listitem"></li></ul>
[aria-valid-attr] Remove or correct the misspelled/invalid ARIA attribute. | aria-labeledby → aria-labelledby
[aria-valid-attr-value] Fix the attribute value to a valid value. aria-pressed must be true/false/mixed. | aria-pressed="yes" → aria-pressed="true"
[aria-prohibited-attr] Remove the ARIA attribute that is explicitly prohibited on this element. | <html aria-hidden="true"> → <html>
[aria-roles] Replace invalid role with the closest valid ARIA role. | role="tab-panel" → role="tabpanel"
[aria-hidden-focus] Remove aria-hidden="true" from the element, or remove the focusable descendant from tab order with tabindex="-1". Prefer removing aria-hidden. | <div aria-hidden="true"><button>OK</button></div> → <div><button>OK</button></div>
[aria-hidden-body] Remove aria-hidden attribute from body element entirely. | <body aria-hidden="true"> → <body>
[aria-dialog-name] Add aria-label or aria-labelledby to dialog/alertdialog element. | <div role="dialog"> → <div role="dialog" aria-label="Confirmation dialog">
[aria-input-field-name] Add aria-label to ARIA input fields (role=textbox/searchbox/spinbutton). | <div role="textbox"> → <div role="textbox" aria-label="Search query">
[aria-toggle-field-name] Add aria-label to toggle controls (role=checkbox/switch/radio). | <div role="switch"> → <div role="switch" aria-label="Enable notifications">
[aria-progressbar-name] Add aria-label and aria-valuenow/min/max to progressbar. | <div role="progressbar"> → <div role="progressbar" aria-label="Upload progress" aria-valuenow="50" aria-valuemin="0" aria-valuemax="100">
[aria-roledescription] aria-roledescription requires an explicit role. Add the appropriate role. | <div aria-roledescription="slide"> → <div role="group" aria-roledescription="slide">
[aria-role-application-misuse] Remove role="application" from generic elements (div, span, section, p, li, article). If the element has aria-expanded, replace role="application" with role="button" — it is an accordion toggle. If multiple role= attributes exist on the same element, remove ALL role= attributes first, then assign the single correct one. If no aria-expanded and no other role hint, remove role="application" entirely. Never add role="application" — only remove or replace it. | <div role="application" aria-expanded="false"> → <div role="button" aria-expanded="false"> | <div role="application"> → <div>
[aria-roles] When replacing an invalid ARIA role on a content card or section div:
  - div/section acting as a self-contained content card → role="article"
  - div acting as a navigation list → role="list" or role="navigation"
  - div acting as a dialog/modal → role="dialog"
  - div acting as a tab panel → role="tabpanel"
  - DO NOT use role="region" for content cards — it creates spurious landmarks.
  - role="region" is ONLY correct for major uniquely-named page sections (think: a
    "Breaking News" band on a news site, not a standard product card).
  - When multiple sibling elements need the same role fix (e.g. four disability
    category cards), use the SAME role for ALL of them — consistency is required.

PAGE STRUCTURE
[document-title] Add or fix <title> element. Must be descriptive and unique. | <title></title> → <title>Page Name - Site Name</title>
[document-title] When fixing a missing or empty <title> element:
  - A pageContext object is provided in the request body with h1 and metaDescription fields.
  - Use pageContext.h1 as the title if present (concise, meaningful, max 70 chars).
  - Fallback to pageContext.metaDescription first sentence if h1 is absent.
  - Fallback to "Web Page" only when neither is available.
  - NEVER return an empty <title></title>.
  - NEVER invent a title unrelated to the page content.
  - DO include context: if the page is clearly a product page, blog post, or demo, append
    the site name if available: "Product Name — Site Name".
[html-has-lang] Add lang attribute to <html> tag. Default to "en" if language cannot be determined. | <html> → <html lang="en">
[html-lang-valid] Fix the lang attribute value to a valid BCP 47 language tag. | lang="english" → lang="en"
[html-xml-lang-mismatch] Make xml:lang match the lang attribute value exactly. | lang="en" xml:lang="fr" → lang="en" xml:lang="en"
[meta-viewport] Remove user-scalable=no and maximum-scale values below 2 from viewport meta. | content="width=device-width,user-scalable=no" → content="width=device-width,initial-scale=1"
[meta-refresh] Remove content="N;url=..." auto-redirect, or change timeout to 0 for instant redirect only. | <meta http-equiv="refresh" content="5"> → remove element

HEADINGS
[heading-order] Change this heading's level to the correct sequential level. Do not skip levels. | <h3>Section title</h3> after <h1> → <h2>Section title</h2>

TABLES
[scope-attr-valid] Fix scope attribute to valid value: col, row, colgroup, or rowgroup. | <th scope="column"> → <th scope="col">
[table-duplicate-name] The table caption and summary say the same thing. Remove the summary attribute. | remove summary attribute
[th-has-data-cells] Add aria-label to th that has no associated data cells. | <th></th> → <th aria-label="Row actions">
[empty-table-header] Add aria-label to the empty th element. | <th></th> → <th aria-label="Actions">

LISTS
[list] Remove or fix invalid direct children of ul/ol. Only li is permitted. Wrap text nodes in <li>. | <ul><div>item</div></ul> → <ul><li>item</li></ul>
[listitem] Wrap orphaned li in a ul. | <li>item</li> → <ul><li>item</li></ul>
[definition-list] Fix invalid children of dl. Only dt and dd are permitted. | <dl><li>term</li></dl> → <dl><dt>term</dt><dd>definition</dd></dl>

DUPLICATES
[duplicate-id] Make the id unique by appending "-2". | id="name" (duplicate) → id="name-2"
[duplicate-id-active] Same as duplicate-id but for focusable/interactive elements. | id="btn" → id="btn-2"
[duplicate-id-aria] Same as duplicate-id but for ids referenced by ARIA attributes. | id="label-text" → id="label-text-2"

IFRAMES
[frame-title] Add a title attribute to the iframe describing its content. | <iframe src="map.html"> → <iframe src="map.html" title="Store location map">
[frame-focusable-content] Same as frame-title — iframe with interactive content must have a title. | <iframe src="form.html"> → <iframe src="form.html" title="Contact form">

SCROLLABLE
[scrollable-region-focusable] Add tabindex="0" and role="region" with aria-label to make scrollable container keyboard accessible. | <div style="overflow:auto"> → <div style="overflow:auto" tabindex="0" role="region" aria-label="Scrollable content">

DEPRECATED ELEMENTS
[blink] Remove <blink> element. Preserve its text content as a <span>. | <blink>text</blink> → <span>text</span>
[marquee] Remove <marquee> element. Preserve its content as a <div>. | <marquee>text</marquee> → <div>text</div>

COLOR
[color-contrast] Increase contrast between text color and background to meet 4.5:1 ratio (AA). Apply contrast-safe colors: dark text on light bg → #1a1a1a on #ffffff. | color:#999 → color:#767676

KEYBOARD & FOCUS
[tabindex] Remove tabindex values greater than 0. Replace with tabindex="0" if focusability is needed. | tabindex="3" → tabindex="0"
[keyboard-unreachable] Remove tabindex="-1" from naturally focusable elements (a[href], button, input). | <a href="/page" tabindex="-1"> → <a href="/page">

General: If the violation ID is not listed above, apply the most semantically appropriate fix based on the description provided. Preserve all JavaScript, event handlers, classes, inline styles, and data attributes not related to the violation. Return ONLY the corrected HTML element.`;

// ─── IMAGE-ALT VISION PROMPT (used when actual image data is available) ─────
// v11: Updated to handle both missing alt (image-alt) and existing bad alt (image-alt-filename).
// "added or corrected" instructs Gemini to replace a bad existing alt, not append a second one.
const VISION_PROMPT = `You are a web accessibility expert. Look at the image provided.
Write a concise, accurate alt attribute (under 125 characters) describing what the image actually shows.
Return ONLY the complete fixed <img> HTML tag with the alt attribute added or corrected (replace any existing incorrect alt value entirely). No markdown, no backticks, no explanation.

HTML TO FIX:
`;

// ─── UTILITIES ──────────────────────────────────────────────────────────────

function normalizeToDom(html: string): string {
    return html.replace(/(?<!data-af-)\b(on[a-z]+)\s*=/gi, "data-af-$1=");
}

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

function getInnerHtml(html: string, tag: string): string {
    const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? m[1] : "";
}

function labelFromUrl(url: string): string {
    try {
        const path = new URL(url).pathname;
        const segment = path.split("/").filter(Boolean).pop() ?? "";
        return segment.replace(/[-_]/g, " ").replace(/\.[^.]+$/, "").trim() || "Linked content";
    } catch {
        const segment = url.split("/").filter(Boolean).pop()?.split("?")[0] ?? "";
        return segment.replace(/[-_]/g, " ").replace(/\.[^.]+$/, "").trim() || "Linked content";
    }
}

function isMeaninglessFilename(filename: string): boolean {
    return !filename || !/\.[a-z]{2,4}$/i.test(filename) || /\d{8,}/.test(filename) || /^[a-f0-9-]{20,}$/i.test(filename);
}

// ── Alt-text validation helpers ───────────────────────────────────────────────

/**
 * Returns true if an alt value is just echoing the src URL or file path.
 * Catches: domain names, file paths, extensions, UUIDs used as alt text.
 */
// P15: SYNC-WARNING — this function is duplicated in app/api/best-practices/heal/route.ts.
// Any change here MUST be mirrored there. Shared lib refactor is tracked as tech debt.
function isBadAlt(alt: string, src: string): boolean {
    // v11: Split the null-guard from the empty-string guard.
    // Previously: !alt returned false for BOTH null/undefined AND "" — the empty-string
    // case is wrong. An empty alt on a non-decorative image that reached this gate IS bad.
    // (This gate only fires inside PATTERN 4, which only runs on non-decorative images.)
    // For opaque CDN images: isBadAlt("", src) now returns true, deriveAltFromFilename(src)
    // returns null (opaque), so the gate writes alt="" again — no regression, but the gate
    // is now logically correct and ready for future cases where derive succeeds.
    if (alt == null) return false;            // null/undefined — no string to evaluate
    if (alt.trim() === '') return true;       // empty alt on non-decorative image IS bad
    if (alt.trim().length <= 1) return false; // single char — too short to evaluate meaningfully
    const a = alt.trim().toLowerCase();
    const s = src.trim().toLowerCase();
    // Direct match against src
    if (a === s) return true;
    // Is a URL (contains protocol or is domain-like with no spaces)
    if (/https?:\/\//.test(a)) return true;
    if (/^[a-z0-9.-]+\.(com|net|org|io|edu|gov|co|uk|svg|png|jpg|jpeg|gif|webp)\b/.test(a) && !a.includes(' ')) return true;
    // Is a file path (starts with / or ./)
    if (/^\.?\//.test(a)) return true;
    // Ends with an image extension
    if (/\.(svg|png|jpg|jpeg|gif|webp|bmp|tiff|ico)$/.test(a)) return true;


    // Looks like a UUID or photo hash (8+ hex chars, dashes, no spaces)
    if (/^[a-f0-9]{8}[a-f0-9-]*$/i.test(a)) return true;
    // P10b: Extended opaque-ID detection — catches pure hex UUIDs AND prefixed photo/image
    // IDs used by Unsplash (photo-NNN-hexhash), Pexels, Cloudinary, AWS S3, and similar CDNs.
    // Original hex-only regex missed "photo-1491553895911-0055eca6402d" because of the prefix.
    if (/^(?:photo|image|img|pic|pexels|pixabay|unsplash|asset|file|upload|media|resource)[-_]\w{4,}/i.test(a)) return true;
    if (/\d{8,}/.test(a) && a.replace(/[\d\-_]/g, '').length < 4) return true; // mostly-numeric with dashes
    // Exactly a generic single word (or generic word + trailing number/extension — still meaningless).
    // Uses exact-match only: "Logo of the company" is NOT flagged; "logo" and "logo 1" ARE flagged.
    const GENERIC_WORDS = new Set(['image', 'photo', 'picture', 'img', 'graphic', 'icon', 'logo', 'thumbnail', 'banner', 'placeholder']);
    const withoutTrailingNoise = a.replace(/[\s\-_]?\d+$/, '').replace(/\.(jpg|png|gif|svg|webp|bmp|tiff|ico)$/, '').trim();
    if (GENERIC_WORDS.has(withoutTrailingNoise)) return true;
    return false;
}

/**
 * Derives a human-readable alt string from the image filename.
 * Returns null when the filename is opaque (UUID, photo-NNN, random hash).
 * Appends " icon" when the src path contains "icon".
 */
// P15: SYNC-WARNING — this function is duplicated in app/api/best-practices/heal/route.ts.
// Any change here MUST be mirrored there. Shared lib refactor is tracked as tech debt.
function deriveAltFromFilename(src: string): string | null {
    // Extract filename without extension from URL or path
    const match = src.match(/\/([^/?#]+?)\.[a-z]{2,5}(?:[?#].*)?$/i);
    if (!match) return null;
    const raw = match[1];
    // Reject opaque names: UUIDs, photo IDs, long hex hashes, numeric IDs
    if (/^[a-f0-9-]{8,}$/i.test(raw)) return null;
    if (/photo[-_]?\d{5,}/i.test(raw)) return null;
    if (/^\d+$/.test(raw)) return null;
    if (raw.length > 40) return null;
    // Strip common prefixes like "icon-", "img-", "image-"
    const cleaned = raw
        .replace(/^(icon|img|image|ic)[-_]/i, '')
        .replace(/[-_]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (cleaned.length < 2) return null;
    const label = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    // Append "icon" suffix when path indicates an icon
    const isIcon = /\/icons?\//i.test(src) || /^icon/i.test(raw);
    return isIcon ? `${label} icon` : label;
}

// ── Contrast-safe text color picker ──────────────────────────────────────────
/**
 * Given a CSS background-color value (hex or rgb), returns either #1a1a1a or
 * #ffffff — whichever achieves higher contrast against that background.
 * Falls back to #1a1a1a (safe on white) when color cannot be parsed.
 */
function pickContrastTextColor(bgValue: string): string {
    let r = 255, g = 255, b = 255; // default: assume white background
    // Try #rgb or #rrggbb
    const hexMatch = bgValue.match(/#([0-9a-fA-F]{3,6})\b/);
    if (hexMatch) {
        const h = hexMatch[1];
        const full = h.length === 3
            ? h.split('').map((c: string) => c + c).join('')
            : h;
        r = parseInt(full.slice(0, 2), 16);
        g = parseInt(full.slice(2, 4), 16);
        b = parseInt(full.slice(4, 6), 16);
    } else {
        // Try rgb(r, g, b) or rgba(r, g, b, a)
        const rgbMatch = bgValue.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (rgbMatch) {
            r = parseInt(rgbMatch[1]);
            g = parseInt(rgbMatch[2]);
            b = parseInt(rgbMatch[3]);
        }
        // Named colors and CSS variables → fallback to dark text (safe on white)
        else { return '#1a1a1a'; }
    }
    // Perceived brightness (YIQ formula — fast approximation of luminance)
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness < 128 ? '#ffffff' : '#1a1a1a';
}

// ─── OFFLINE HEURISTIC FALLBACK ─────────────────────────────────────────────
function applyOfflineFix(violation: AxeViolation, nodeHtml: string, pageContext?: { h1?: string; metaDescription?: string; ogTitle?: string; nearestText?: string }): string {
    let fixed = nodeHtml.trim();
    const vid = violation.id;

    // <a> acting as button → <button>
    const isAnchorFakeButton = /^<a\b/i.test(fixed) && (
        /\bclass=["'][^"']*demo-btn[^"']*["']/i.test(fixed) ||
        /\bdata-af-on\w+=/i.test(fixed) ||
        /\brole=["']button["']/i.test(fixed)
    );
    if (isAnchorFakeButton) {
        const inner = getInnerHtml(fixed, "a");
        const events = [...fixed.matchAll(/data-af-on\w+=(?:"[^"]*"|'[^']*')/gi)].map((m) => m[0]).join(" ");
        const classMatch = fixed.match(/\bclass=["']([^"']*)["']/i);
        const classAttr = classMatch ? ` class="${classMatch[1]}"` : "";
        const idMatch = fixed.match(/\bid=["']([^"']*)["']/i);
        const idAttr = idMatch ? ` id="${idMatch[1]}"` : "";
        const styleAttr = /background-color/i.test(fixed) ? "" : ' style="background-color:#1a56db;color:#ffffff;border:none;padding:10px 20px;border-radius:5px;cursor:pointer;font-weight:bold;"';
        fixed = `<button${idAttr}${styleAttr}${classAttr}${events ? " " + events : ""}>${inner}</button>`;
    }
    // <div role="button"> → <button>
    if (/^<div\b/i.test(fixed) && /\brole=["']button["']/i.test(fixed)) {
        fixed = fixed.replace(/^<div\b/i, "<button").replace(/<\/div>$/i, "</button>").replace(/\s*role=["']button["']/gi, "");
        fixed = fixed.replace(/aria-pressed=["']yes["']/gi, 'aria-pressed="true"').replace(/aria-pressed=["']no["']/gi, 'aria-pressed="false"');
        // v23: After tag conversion, apply toggle-detection + strip for aria-pressed.
        // This path was the missing link: class-signal fake-btn block has this logic but
        // skips when fixed is already <button> (which it is after the conversion above).
        // The role="button" div path normalizes "yes"→"true" but never stripped for
        // non-toggle buttons (Add to Cart, Submit, Checkout etc.) — leaving a permanent
        // static aria-pressed="true" that screen readers announce as "pressed" forever.
        // Toggle detection: aria-expanded, aria-controls, or toggle/switch/expand/mute in class.
        if (/\baria-pressed=/i.test(fixed)) {
            const isToggleDivPath = /aria-expanded/.test(fixed) || /aria-controls/.test(fixed) ||
                /\b(toggle|switch|expand|collapse|mute)\b/i.test(
                    (fixed.match(/\bclass=["']([^"']*)["']/i) ?? [])[1] ?? ""
                );
            if (isToggleDivPath) {
                fixed = fixed.replace(/\baria-pressed=["'][^"']*["']/g, 'aria-pressed="false"');
            } else {
                fixed = fixed.replace(/\s*\baria-pressed=["'][^"']*["']/g, "");
            }
        }
    }
    // v17: Class-signal fake-btn conversion — handles <div class="fake-btn"> and similar
    // class-only fake buttons that have no role="button" but have a button-class AND onclick.
    // These are missed by the role="button" branch above and by Gemini when quota is exhausted.
    // Covers: fake-btn, btn, button, cta, action-btn, action-cta (word-boundary safe).
    // Guard: element must also have data-af-onclick (sanitized onclick) to confirm interactivity.
    // Does NOT fire on structural containers (card, wrapper) — they pass the onclick guard.
    // Does NOT fire on elements already converted to <button> by the role="button" branch above.
    if (
        /^<(div|span|li|p)\b/i.test(fixed) &&
        !/^<button\b/i.test(fixed) &&
        /\b(fake-btn|fake-button|action-btn|action-cta|btn|cta)\b/i.test(
            (fixed.match(/\bclass=["']([^"']*)["']/i) ?? [])[1] ?? ""
        ) &&
        /\bdata-af-onclick=/i.test(fixed)
    ) {
        const tagMatch = fixed.match(/^<(\w+)\b/i);
        const oldTag = tagMatch?.[1] ?? "div";
        const inner = (() => {
            const m = fixed.match(new RegExp(`<${oldTag}\\b[^>]*>([\\s\\S]*?)<\\/${oldTag}>`, "i"));
            return m ? m[1] : "";
        })();
        const events = [...fixed.matchAll(/data-af-on\w+=(?:"[^"]*"|'[^']*')/gi)].map((m) => m[0]).join(" ");
        const classMatch = fixed.match(/\bclass=["']([^"']*)["']/i);
        const classAttr = classMatch ? ` class="${classMatch[1]}"` : "";
        const idMatch = fixed.match(/\bid=["']([^"']*)["']/i);
        const idAttr = idMatch ? ` id="${idMatch[1]}"` : "";
        const styleMatch = fixed.match(/\bstyle=["']([^"']*)["']/i);
        const styleAttr = styleMatch ? ` style="${styleMatch[1]}"` : "";
        fixed = `<button${idAttr}${classAttr}${styleAttr}${events ? " " + events : ""}>${inner}</button>`;
        // v18: Post-conversion cleanup for class-signal fake-btn → <button>.
        // Strip role="button" (redundant on native <button> — axe flags aria-allowed-attr).
        fixed = fixed.replace(/\s*\brole=["']button["']/gi, "");
        // Strip tabindex="0" (native <button> is focusable by default — redundant noise).
        fixed = fixed.replace(/\s*\btabindex=["']0["']/gi, "");
        // Normalize aria-pressed: only valid on toggle buttons.
        // Toggle signal: aria-expanded, aria-controls, or class/id with toggle|switch|expand|collapse|mute.
        // Non-toggle: strip aria-pressed entirely (Add to Cart, Submit, Create Account etc.).
        // Toggle: normalize to "false" (unpressed default — never leave "true" as static value).
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
    }
    // <span>/<li>/<p> role="button" → <button>
    // P3: Preserve aria-expanded (accordion state) and aria-label through the conversion
    if (/^<(span|li|p)\b/i.test(fixed) && /\brole=["']button["']/i.test(fixed)) {
        const tag = fixed.match(/^<(\w+)\b/i)?.[1] ?? "div";
        const inner = getInnerHtml(fixed, tag);
        const events = [...fixed.matchAll(/data-af-on\w+=(?:"[^"]*"|'[^']*')/gi)].map((m) => m[0]).join(" ");
        const classMatch = fixed.match(/\bclass=["']([^"']*)["']/i);
        const classAttr = classMatch ? ` class="${classMatch[1]}"` : "";
        const idMatch = fixed.match(/\bid=["']([^"']*)["']/i);
        const idAttr = idMatch ? ` id="${idMatch[1]}"` : "";
        const ariaExpanded = fixed.match(/\baria-expanded=["'][^"']*["']/i)?.[0] ?? "";
        const ariaLabel = fixed.match(/\baria-label=["'][^"']*["']/i)?.[0] ?? "";
        fixed = `<button${idAttr}${classAttr}${ariaExpanded ? " " + ariaExpanded : ""}${ariaLabel ? " " + ariaLabel : ""}${events ? " " + events : ""}>${inner}</button>`;
        // v23: Toggle-detection + strip for aria-pressed on span/li/p conversion path.
        // Mirrors Change 1 (div role="button" path) — same gap, same fix.
        // Prevents static aria-pressed="true" surviving on converted <button> elements
        // from span/li/p fake-button patterns used by some frameworks (e.g. Bootstrap list-groups).
        if (/\baria-pressed=/i.test(fixed)) {
            const isToggleSlpPath = /aria-expanded/.test(fixed) || /aria-controls/.test(fixed) ||
                /\b(toggle|switch|expand|collapse|mute)\b/i.test(
                    (fixed.match(/\bclass=["']([^"']*)["']/i) ?? [])[1] ?? ""
                );
            if (isToggleSlpPath) {
                fixed = fixed.replace(/\baria-pressed=["'][^"']*["']/g, 'aria-pressed="false"');
            } else {
                fixed = fixed.replace(/\s*\baria-pressed=["'][^"']*["']/g, "");
            }
        }
    }



    // Color contrast — handled in the switch below (3-path hardened version)

    // ── Step 1: Inject alt if missing entirely ────────────────────────────────────────────
    // Only runs when the image has no alt attribute at all.
    if (vid === "image-alt" && /<img\s/i.test(fixed) && !/\balt=/i.test(fixed)) {
        const srcMatch = fixed.match(/src=["']([^"']+)["']/i);
        let altText = "Image";
        if (srcMatch) {
            const url = srcMatch[1];
            const filename = url.split("/").pop()?.split("?")[0] ?? "";
            if (!isMeaninglessFilename(filename)) {
                altText = filename.replace(/[-_]/g, " ").replace(/\.[^.]+$/, "").trim() || "Image";
            } else {
                const parts = url.split("/").filter(Boolean);
                const parentFolder = parts[parts.length - 2] ?? "";
                // v16: Guard against domain names leaking as alt text.
                // Reject: protocol tokens ("https:"), domain-like strings (contain "."),
                // and strings too long to be a meaningful folder name (>30 chars).
                // e.g. "images.unsplash.com" contains "." → rejected.
                // e.g. "products" contains no "." and is short → accepted.
                const isDomainLike = parentFolder.includes(".") || parentFolder.length > 30;
                if (parentFolder && !/^https?:$/.test(parentFolder) && !isDomainLike) {
                    altText = parentFolder.replace(/[-_]/g, " ").trim();
                }
            }
        }
        fixed = fixed.replace(/<img\s/i, `<img alt="${altText}" `);
    }
    // ── Step 2: Validate alt for ALL image-alt violations ────────────────────────────
    // Runs whether alt was just injected above OR was pre-existing but bad.
    // Separated from Step 1 so it catches: re-scans after a partial fix, manual edits
    // that left a URL in alt, and pre-existing bad alts on axe re-runs.
    // Covers all websites: CDN URLs, data URIs, blob URLs, relative paths.
    if (vid === "image-alt" && /<img\s/i.test(fixed)) {
        const srcAttr = (fixed.match(/\bsrc=["']([^"']+)["']/i) ?? [])[1] ?? "";
        const altAttr = (fixed.match(/\balt=["']([^"']*)["']/i) ?? [])[1] ?? "";
        if (isBadAlt(altAttr, srcAttr)) {
            const derived = deriveAltFromFilename(srcAttr);
            if (derived) {
                // Replace bad alt with filename-derived label
                fixed = fixed.replace(/(\balt=["'])[^"']*["']/, `$1${derived}"`);
            } else {
                // Opaque CDN URL — use surrounding page context before declaring decorative.
                // v14: prefer nearestText (product name nearest to this image) over page h1.
                // h1 is section-level ("Featured Products") — same for all images in a grid.
                // nearestText is element-specific ("Running Shoes", "Smartphone") — unique per image.
                //
                // v16: for image-alt (MISSING alt), only use nearestText — not h1.
                // h1 is the site/page name (e.g. "TechGadgets Store"), not the image subject.
                // Using h1 as alt for a missing-alt image produces misleading screen reader output.
                // Honest empty alt is better than wrong alt when nearestText is unavailable.
                // For image-alt-filename (BAD existing alt), h1 is still a valid fallback because
                // any meaningful context is better than a file path or UUID left in place.
                const isImageAltViolation = vid === "image-alt";
                const contextSource = isImageAltViolation
                    ? (pageContext?.nearestText ?? null)                       // image-alt: nearestText only
                    : (pageContext?.nearestText ?? pageContext?.h1 ?? null);   // image-alt-filename: nearestText OR h1
                const contextAlt = contextSource
                    ? `${contextSource.trim().slice(0, 80)} image`
                    : null;
                if (contextAlt) {
                    fixed = fixed.replace(/(\balt=["'])[^"']*["']/, `$1${contextAlt}"`);
                } else {
                    // No context available — empty alt is the honest fallback
                    fixed = fixed.replace(/(\balt=["'])[^"']*["']/, `$1"`);
                    if (!/\brole=/.test(fixed)) {
                        fixed = fixed.replace(/^(<[a-z][a-z0-9]*\b)/i, '$1 role="presentation"');
                    }
                }
            }
        }
    }

    // <input> missing label
    if (vid === "label" && /<input\b/i.test(fixed) && !/aria-label=/i.test(fixed) && !/aria-labelledby=/i.test(fixed)) {
        const placeholder = fixed.match(/placeholder=["'](.*?)["']/i)?.[1];
        const type = fixed.match(/type=["'](.*?)["']/i)?.[1];
        const name = fixed.match(/name=["'](.*?)["']/i)?.[1];
        const id = fixed.match(/id=["'](.*?)["']/i)?.[1];
        const safeTypes = new Set(["text", "email", "password", "search", "tel", "url", "number", "date"]);
        const labelText = placeholder
            || (type && safeTypes.has(type) ? type.charAt(0).toUpperCase() + type.slice(1) + " field" : null)
            || (name ? name.replace(/[-_]/g, " ").replace(/([A-Z])/g, " $1").trim() : null)
            || (id ? id.replace(/[-_]/g, " ").replace(/([A-Z])/g, " $1").trim() : null)
            || "Input field";
        fixed = fixed.replace(/<input\b/i, `<input aria-label="${labelText}" `);
    }

    // <select> missing label
    if (vid === "label" && /<select\b/i.test(fixed) && !/aria-label=/i.test(fixed) && !/aria-labelledby=/i.test(fixed)) {
        const labelText = (fixed.match(/name=["'](.*?)["']/i)?.[1] || fixed.match(/id=["'](.*?)["']/i)?.[1] || "").replace(/[-_]/g, " ").replace(/([A-Z])/g, " $1").trim() || "Select option";
        fixed = fixed.replace(/<select\b/i, `<select aria-label="${labelText}" `);
    }

    // <textarea> missing label
    if (vid === "label" && /<textarea\b/i.test(fixed) && !/aria-label=/i.test(fixed) && !/aria-labelledby=/i.test(fixed)) {
        const labelText = fixed.match(/placeholder=["'](.*?)["']/i)?.[1] || (fixed.match(/name=["'](.*?)["']/i)?.[1]?.replace(/[-_]/g, " ").trim()) || "Text area";
        fixed = fixed.replace(/<textarea\b/i, `<textarea aria-label="${labelText}" `);
    }

    // Link with no accessible name
    if (vid === "link-name" && /^<a\b/i.test(fixed) && !/aria-label=/i.test(fixed) && !/aria-labelledby=/i.test(fixed)) {
        const linkText = getInnerHtml(fixed, "a").replace(/<[^>]*>/g, "").trim();
        const href = fixed.match(/href=["']([^"']+)["']/i)?.[1] ?? "";
        if (!linkText) {
            fixed = fixed.replace(/<a\b/i, `<a aria-label="${href ? labelFromUrl(href) : "Link"}" `);
        } else if (/^(click here|read more|learn more|more|here|link|click|go|see more|view more|details|info|this)$/i.test(linkText)) {
            fixed = fixed.replace(/<a\b/i, `<a aria-label="${href ? `${linkText} — ${labelFromUrl(href)}` : "Navigate to linked content"}" `);
        }
    }

    // Button with no accessible name (icon-only)
    if (vid === "button-name" && /^<button\b/i.test(fixed) && !/aria-label=/i.test(fixed) && !/aria-labelledby=/i.test(fixed)) {
        const btnText = getInnerHtml(fixed, "button").replace(/<[^>]*>/g, "").trim();
        if (!btnText || /^[×✕✖✗&\s;]+$/.test(btnText)) {
            const type = fixed.match(/\btype=["'](.*?)["']/i)?.[1] ?? "";
            const label = type === "submit" ? "Submit" : type === "reset" ? "Reset form" : "Button";
            fixed = fixed.replace(/<button\b/i, `<button aria-label="${label}" `);
        }
    }

    // iframe missing title
    if ((vid === "frame-title" || vid === "frame-tested") && /<iframe\b/i.test(fixed) && !/\btitle=/i.test(fixed)) {
        const src = fixed.match(/src=["']([^"']+)["']/i)?.[1] ?? "";
        let title = "Embedded content";
        if (src.includes("youtube.com") || src.includes("youtu.be")) title = "YouTube video player";
        else if (src.includes("google.com/maps") || src.includes("maps.google")) title = "Google Maps";
        else if (src.includes("vimeo.com")) title = "Vimeo video player";
        else if (src) title = labelFromUrl(src) || "Embedded content";
        fixed = fixed.replace(/<iframe\b/i, `<iframe title="${title}" `);
    }

    // Invalid ARIA attribute values
    if (vid === "aria-allowed-attr" || vid === "aria-valid-attr-value") {
        fixed = fixed.replace(/aria-pressed=["']yes["']/gi, 'aria-pressed="true"').replace(/aria-pressed=["']no["']/gi, 'aria-pressed="false"');
        fixed = fixed.replace(/aria-expanded=["']yes["']/gi, 'aria-expanded="true"').replace(/aria-expanded=["']no["']/gi, 'aria-expanded="false"');
        fixed = fixed.replace(/aria-checked=["']yes["']/gi, 'aria-checked="true"').replace(/aria-checked=["']no["']/gi, 'aria-checked="false"');
        fixed = fixed.replace(/aria-hidden=["']yes["']/gi, 'aria-hidden="true"').replace(/aria-hidden=["']no["']/gi, 'aria-hidden="false"');
    }

    // aria-hidden on focusable element
    if (vid === "aria-hidden-focus" && /aria-hidden=["']true["']/i.test(fixed) && /^<(a|button|input|select|textarea)\b/i.test(fixed)) {
        fixed = fixed.replace(/\s*aria-hidden=["']true["']/gi, "");
    }

    // Scrollable region not keyboard focusable
    if (vid === "scrollable-region-focusable" && !/tabindex=/i.test(fixed)) {
        fixed = fixed.replace(/^<(\w+)\b/i, `<$1 tabindex="0"`);
    }

    // Missing lang on <html>
    if ((vid === "html-has-lang" || vid === "html-lang-valid") && /^<html\b/i.test(fixed)) {
        if (!/\blang=/i.test(fixed)) fixed = fixed.replace(/<html\b/i, '<html lang="en"');
        else fixed = fixed.replace(/\blang=["']\s*["']/i, 'lang="en"');
    }

    // ── Extended offline cases ───────────────────────────────────────────────
    switch (vid) {
        case "color-contrast": {
            // Detect element tag — table cells need text-only fix (no background override)
            const tagMatch = fixed.match(/^<([a-z][a-z0-9]*)\b/i);
            const tag = tagMatch ? tagMatch[1].toLowerCase() : "";
            const isTableCell = /^t[hd]$/.test(tag);

            const hasStyle = /\bstyle=["'][^"']*["']/i.test(fixed);
            const hasColor = /(?<![a-z-])color\s*:/i.test(fixed);
            const hasBgColor = /\bbackground-color\s*:/i.test(fixed);
            // background: shorthand — negative lookbehind excludes "background-color:"
            const hasBgShorthand = /(?<!background-)background\s*:/i.test(fixed);
            const hasBg = hasBgColor || hasBgShorthand;

            if (hasStyle && (hasColor || hasBg)) {
                // PATH A — inline style exists and has color and/or background values
                // Extract any inline background color first so we pick the right text color.
                const pathABgMatch = fixed.match(/background(?:-color)?\s*:\s*([^;'"]+)/i);
                const pathATextColor = pathABgMatch
                    ? pickContrastTextColor(pathABgMatch[1].trim())
                    : '#1a1a1a';
                if (hasColor) {
                    fixed = fixed.replace(
                        /(\bstyle=["'][^"']*(?<![a-z-])color\s*:\s*)[^;'"]+/i,
                        `$1${pathATextColor}`
                    );
                }
                // Replace background-color ONLY on safe container elements, never table cells
                const isSafeToReplaceBg = hasBgColor && !isTableCell &&
                    /^(?:div|section|article|aside|header|footer|main|span|p)$/.test(tag);
                if (isSafeToReplaceBg) {
                    fixed = fixed.replace(
                        /(\bstyle=["'][^"']*\bbackground-color\s*:\s*)[^;'"]+/i,
                        "$1#ffffff"
                    );
                }
                // background: shorthand is too complex to safely rewrite — only add color if missing
                if (!hasColor) {
                    fixed = fixed.replace(
                        /\bstyle=(["'])([^"']*)\1/i,
                        (_: string, q: string, existing: string) => {
                            const base = existing.replace(/;\s*$/, "");
                            return `style=${q}${base}${base ? ";" : ""}color:${pathATextColor};${q}`;
                        }
                    );
                }
            } else if (hasStyle) {
                // PATH B — element has background but no color: inject contrast-safe text color
                const pathBBgMatch = fixed.match(/background(?:-color)?\s*:\s*([^;'"]+)/i);
                const pathBTextColor = pathBBgMatch
                    ? pickContrastTextColor(pathBBgMatch[1].trim())
                    : '#1a1a1a';
                fixed = fixed.replace(
                    /\bstyle=(["'])([^"']*)\1/i,
                    (_: string, q: string, existing: string) => {
                        const base = existing.replace(/;\s*$/, "");
                        // Table cells: only inject text color — respect CSS-defined background
                        const append = isTableCell
                            ? "color:#000000;"
                            : `color:${pathBTextColor};background-color:#ffffff;`;
                        return `style=${q}${base}${base ? ";" : ""}${append}${q}`;
                    }
                );
            } else {
                // PATH C — no inline style at all: inject new style= attribute.
                // v18: Added !important to color values so the inline override wins the CSS
                // cascade unconditionally, regardless of class specificity or rule order.
                // This makes class-only color-contrast fixes bulletproof on re-scan:
                // e.g. .low-contrast { color: #aaa } → element gets style="color:#1a1a1a !important"
                // which always overrides the class rule at any specificity level.
                // background-color does NOT get !important — less risky, avoids layout side-effects.
                const cls = (fixed.match(/\bclass=["']([^"']*)["']/i) ?? [])[1] ?? "";
                const isPrimary = /\b(?:primary|cta|btn-primary|btn-dark|danger|success)\b/i.test(cls);
                const colors = isPrimary
                    ? "color:#ffffff !important;background-color:#1a56db;"   // white on blue  4.57:1 ✓
                    : isTableCell
                        ? "color:#000000 !important;"                           // cell: text only, 21:1 ✓
                        : "color:#1a1a1a !important;background-color:#ffffff;"; // other: full 16.1:1 ✓
                fixed = fixed.replace(/^(<[a-z][a-z0-9]*\b)/i, `$1 style="${colors}"`);
            }
            break;
        }
        case "image-alt-filename": {
            // Extract filename from src= attribute
            const srcMatch = fixed.match(/\bsrc=["']([^"']+)["']/i);
            const filename = srcMatch
                ? (srcMatch[1].split("/").pop() ?? "").split("?")[0]
                : "";
            // Normalize: strip extension, URI-decode, separators → spaces, lowercase
            const stem = decodeURIComponent(filename)
                .replace(/\.[^.]+$/, "")
                .replace(/[-_+%]/g, " ")
                .toLowerCase()
                .trim();

            // PATTERN 1 — Decorative / structural images: empty alt + role="presentation"
            if (/\b(spacer|pixel|blank|transparent|placeholder|divider|separator|dot|1x1|2x2|line|rule|border|bg|background|texture|pattern|noise|grain|shadow|gradient|overlay|mask)\b/.test(stem)) {
                fixed = fixed.replace(/\balt=["'][^"']*["']/i, 'alt=""');
                if (!/\brole=/i.test(fixed)) {
                    fixed = fixed.replace(/^(<img\b)/i, '$1 role="presentation"');
                }
                break;
            }

            // PATTERN 2 — Generic structural words → no-op, fall through to Gemini
            // "Header", "Banner", "Logo" etc. tell screen reader users nothing.
            const isGenericStructural = /^(header|banner|hero|masthead|splash|jumbotron|main|top|bottom|logo|brand|mark|wordmark|emblem|seal|crest|shield|image|photo|picture|img|graphic|visual|media|content|default|thumbnail|featured|cover|bg|background|icon)$/.test(
                stem.replace(/\s+/g, "")
            );
            if (isGenericStructural) {
                // Return unchanged — caller detects no change and falls through to Gemini
                break;
            }

            // PATTERN 3 — Icon images: icon-X, X-icon, X-ico → "X Icon"
            const iconMatch = stem.match(/^(?:icon\s+(.+)|(.+?)\s+icon|(.+?)\s+ico)$/i);
            if (iconMatch) {
                const iconName = (iconMatch[1] ?? iconMatch[2] ?? iconMatch[3] ?? "").trim();
                if (iconName) {
                    const titleName = iconName.replace(/\b\w/g, (c) => c.toUpperCase());
                    fixed = fixed.replace(/\balt=["'][^"']*["']/i, `alt="${titleName} Icon"`);
                    break;
                }
            }

            // PATTERN 4 — Default: try deriveAltFromFilename first (UUID guard), then title-case.
            // P10: deriveAltFromFilename is called HERE before title-casing to catch opaque CDN URLs
            // (Unsplash photo-NNN, UUIDs, long hashes) that would otherwise produce garbage alt text.
            // Only title-case stems that deriveAltFromFilename confirms are human-readable.
            {
                const srcForDerive = (fixed.match(/\bsrc=["']([^"']+)["']/i) ?? [])[1] ?? "";
                const derived = deriveAltFromFilename(srcForDerive);
                if (derived) {
                    // deriveAltFromFilename confirmed this is a readable filename — use its output
                    fixed = fixed.replace(/\balt=["'][^"']*["']/i, `alt="${derived}"`);
                } else {
                    // Opaque CDN URL (UUID, photo-NNN, random hash, too long) — title-casing would
                    // produce garbage. Use surrounding page context instead.
                    // v14: prefer nearestText (product name nearest to this image) over page h1.
                    // h1 is section-level ("Featured Products") — same for all images in a grid.
                    // nearestText is element-specific ("Running Shoes", "Smartphone") — unique per image.
                    const contextSource = pageContext?.nearestText ?? pageContext?.h1 ?? null;
                    const contextAlt = contextSource
                        ? `${contextSource.trim().slice(0, 80)} image`
                        : null;
                    if (contextAlt) {
                        fixed = fixed.replace(/\balt=["'][^"']*["']/i, `alt="${contextAlt}"`);
                    } else {
                        // No context — honest empty alt + role="presentation"
                        fixed = fixed.replace(/\balt=["'][^"']*["']/i, `alt=""`);
                        if (!/\brole=/i.test(fixed)) {
                            fixed = fixed.replace(/^(<img\b)/i, '$1 role="presentation"');
                        }
                    }
                }
            }
            // ── Final isBadAlt gate: universal safety net after all four patterns ──────
            // Catches edge cases where the stem itself was domain-like or path-like
            // (e.g. filename "cdn.example.com.jpg" → titleCased "Cdn.example.com").
            // isBadAlt lowercases before checking, so capitalisation doesn't hide it.
            // Runs AFTER all patterns so it never interferes with earlier derivation.
            {
                const srcFinal = (fixed.match(/\bsrc=["']([^"']+)["']/i) ?? [])[1] ?? "";
                const altFinal = (fixed.match(/\balt=["']([^"']*)["']/i) ?? [])[1] ?? "";
                if (isBadAlt(altFinal, srcFinal)) {
                    const derivedFinal = deriveAltFromFilename(srcFinal);
                    fixed = fixed.replace(
                        /(\balt=["'])[^"']*["']/i,
                        derivedFinal ? `$1${derivedFinal}"` : `$1"`
                    );
                }
            }
            break;
        }

        case "new-tab-warning":
            // Match the full <a>...</a> so we can extract inner text for a meaningful label.
            // Falls back to "Link (opens in new tab)" only when inner content is purely icons/empty.
            fixed = fixed.replace(/^(<a\b[^>]*)>([\s\S]*?)<\/a>/i, (_: string, open: string, inner: string) => {
                const linkText = inner.replace(/<[^>]+>/g, '').trim();
                if (/aria-label=/i.test(open))
                    return open.replace(/aria-label=["']([^"']*)["']/i,
                        (_2: string, v: string) => `aria-label="${v} (opens in new tab)"`) + `>${inner}</a>`;
                const label = linkText ? `${linkText} (opens in new tab)` : "Link (opens in new tab)";
                return `${open} aria-label="${label}">${inner}</a>`;
            });
            break;

        case "aria-allowed-attr": {
            // aria-pressed on non-toggle is the most common aria-allowed-attr violation.
            // Determine if this element is a toggle button by checking its attributes/class.
            const isToggle =
                /aria-expanded/.test(fixed) ||
                /aria-controls/.test(fixed) ||
                /\b(toggle|switch|expand|collapse|mute)\b/i.test(fixed);
            if (/\baria-pressed=/.test(fixed)) {
                if (isToggle) {
                    // Toggle button: reset to false (unpressed default)
                    fixed = fixed.replace(/\baria-pressed=["'][^"']*["']/g, 'aria-pressed="false"');
                } else {
                    // Not a toggle: remove aria-pressed entirely
                    fixed = fixed.replace(/\s*aria-pressed=["'][^"']*["']/g, '');
                }
            }
            break;
        }
        case "document-title": {
            const ctx = pageContext;
            // Attempt to extract any existing title text as a last resort before giving up.
            // Strip common site-name suffixes (e.g. "Home | ACME Corp" → "Home",
            // "About – My Site" → "About"). Covers WordPress, Webflow, Squarespace patterns.
            const existingTitleMatch = fixed.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const existingTitleRaw = existingTitleMatch ? existingTitleMatch[1].trim() : "";
            const existingTitle = existingTitleRaw
                .split(/\s*[|\-–—:]\s*/)
                .map(s => s.trim())
                .filter(Boolean)[0] ?? "";

            const derived =
                ctx?.h1 ||
                ctx?.metaDescription ||
                ctx?.ogTitle ||
                (existingTitle && existingTitle.length > 2 ? existingTitle : "") ||
                "Untitled Page";

            fixed = fixed.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${derived}</title>`);
            if (!/<title/i.test(fixed)) fixed += `<title>${derived}</title>`;
            break;
        }
        case "meta-viewport":
            fixed = fixed
                .replace(/[,;\s]*user-scalable\s*=\s*\w+/gi, "")
                .replace(/[,;\s]*maximum-scale\s*=\s*[01][^,;"']*/gi, "");
            break;
        case "meta-refresh":
            fixed = ""; // Remove the element entirely
            break;
        case "tabindex":
            fixed = fixed.replace(/\btabindex=["']\d+["']/gi, 'tabindex="0"');
            break;
        case "keyboard-unreachable":
            fixed = fixed.replace(/\s*tabindex=["']-1["']/gi, "");
            break;
        case "keyboard-trap":
            // Strip the keydown handler that suppresses default keyboard behaviour (WCAG 2.1.2).
            // data-af-onkeydown is the sanitized form of onkeydown produced by sanitizeHtml().
            // Removing it lifts the trap; tabindex="0" ensures the element stays reachable.
            fixed = fixed.replace(/\s*data-af-onkeydown=["'][^"']*preventDefault[^"']*["']/gi, "");
            if (!/\btabindex=/i.test(fixed)) {
                fixed = fixed.replace(/^(<[a-z][a-z0-9]*\b)/i, '$1 tabindex="0"');
            }
            break;
        case "nested-interactive":
            fixed = fixed.replace(/^<a\b[^>]*>([\s\S]*)<\/a>$/i, "$1").trim();
            break;
        case "aria-hidden-body":
            fixed = fixed.replace(/\s*aria-hidden=["']true["']/gi, "");
            break;
        case "blink":
            fixed = fixed.replace(/<blink\b[^>]*>([\s\S]*?)<\/blink>/gi, "<span>$1</span>");
            break;
        case "marquee":
            fixed = fixed.replace(/<marquee\b[^>]*>([\s\S]*?)<\/marquee>/gi, "<div>$1</div>");
            break;
        case "duplicate-id":
        case "duplicate-id-active":
        case "duplicate-id-aria": {
            const idMatch = fixed.match(/\bid=["']([^"']+)["']/i);
            if (idMatch) fixed = fixed.replace(new RegExp(`\\bid=["']${idMatch[1]}["']`, "gi"), `id="${idMatch[1]}-2"`);
            break;
        }
        case "scrollable-region-focusable":
            if (!/tabindex=/i.test(fixed))
                fixed = fixed.replace(/^(<(?:div|section|article|main)\b[^>]*)>/i, '$1 tabindex="0" role="region" aria-label="Scrollable content">');
            break;
        case "color-contrast-inline": {
            // v20.1: Fix for SYNTHETIC 6 — inline style="color:#hex" with brightness > 180.
            // Uses same PATH A logic as the color-contrast case but scoped to hex source strings.
            // No background detection needed — SYNTHETIC 6 only fires when no inline bg is present.
            // pickContrastTextColor defaults to #1a1a1a when no bg given (safe on white).
            fixed = fixed.replace(
                /(\bstyle=["'][^"']*(?<![a-z-])color\s*:\s*)#[0-9a-fA-F]{3,6}/i,
                `$1#1a1a1a`
            );
            break;
        }
        case "redundant-button-role": {
            // v19+v20.1: Strip role="button" AND tabindex="0" from native <button>.
            // role="button" is redundant — native <button> has implicit button role.
            // tabindex="0" is redundant — native <button> is focusable by default.
            // v22: Input may be a full element (opening + content + closing tag) since
            // SYNTHETIC 5 now captures the full element for fingerprint resilience.
            // Scope both strips to the opening tag only — extract it, fix it, splice back.
            // This prevents stripping tabindex="0" from nested child elements inside the button.
            const rbOpenTagMatch = fixed.match(/^(<button\b[^>]*>)([\s\S]*)(<\/button>)$/i);
            if (rbOpenTagMatch) {
                const fixedOpen = rbOpenTagMatch[1]
                    .replace(/\s*\brole=["']button["']/gi, "")
                    .replace(/\s*\btabindex=["']0["']/gi, "");
                fixed = `${fixedOpen}${rbOpenTagMatch[2]}${rbOpenTagMatch[3]}`;
            } else {
                // Fallback: opening tag only (pre-v22 format or malformed) — apply directly
                fixed = fixed.replace(/\s*\brole=["']button["']/gi, "");
                fixed = fixed.replace(/\s*\btabindex=["']0["']/gi, "");
            }
            break;
        }
        case "aria-pressed-static":
            if (/\baria-pressed=/i.test(fixed)) {
                const isToggle = /aria-expanded/.test(fixed) || /aria-controls/.test(fixed) ||
                    /\b(toggle|switch|expand|collapse|mute)\b/i.test(fixed);
                if (isToggle) {
                    fixed = fixed.replace(/\baria-pressed=["'][^"']*["']/g, 'aria-pressed="false"');
                } else {
                    fixed = fixed.replace(/\s*\baria-pressed=["'][^"']*["']/g, "");
                }
            }
            break;
        case "heading-order": {
            const levelMap: Record<string, string> = { h3: "h2", h4: "h3", h5: "h4", h6: "h5" };
            fixed = fixed.replace(/^<(h[3-6])(\b[^>]*)>([\s\S]*?)<\/h[3-6]>$/i,
                (_, tag, attrs, content) => { const f = levelMap[tag.toLowerCase()] ?? tag; return `<${f}${attrs}>${content}</${f}>`; });
            break;
        }
        case "empty-heading":
            fixed = ""; // Remove empty headings
            break;
        case "no-autoplay-audio":
            fixed = fixed.replace(/\s*\bautoplay\b/gi, "").replace(/\s*\bloop\b/gi, "");
            break;
        case "html-xml-lang-mismatch": {
            const lm = fixed.match(/\blang=["']([^"']+)["']/i);
            const lang = lm?.[1] ?? "en";
            fixed = fixed.replace(/\bxml:lang=["'][^"']*["']/i, `xml:lang="${lang}"`);
            break;
        }
        case "scope-attr-valid":
            fixed = fixed.replace(/\bscope=["'][^"']*["']/i, 'scope="col"');
            break;
        case "table-duplicate-name":
            fixed = fixed.replace(/\s*\bsummary=["'][^"']*["']/i, "");
            break;
        case "frame-title":
        case "frame-focusable-content":
            if (!/\btitle=/i.test(fixed))
                fixed = fixed.replace(/^(<iframe\b[^>]*)>/i, '$1 title="Embedded content">');
            break;
        case "image-redundant-alt":
            fixed = fixed.replace(/\balt=["'][^"']*["']/i, 'alt="" role="presentation"');
            break;
        case "list":
            fixed = fixed.replace(/<(ul|ol)([^>]*)>([\s\S]*?)<\/(ul|ol)>/gi,
                (_, open, attrs, inner, close) => `<${open}${attrs}>${inner.replace(/<div\b([^>]*)>([\s\S]*?)<\/div>/gi, "<li$1>$2</li>")}</${close}>`);
            break;
        case "aria-role-application-misuse": {
            // Step 1: if duplicate role attributes exist, strip ALL of them first
            const roleMatches = fixed.match(/\brole=/gi) ?? [];
            if (roleMatches.length > 1) {
                fixed = fixed.replace(/\s*\brole=["'][^"']*["']/gi, "");
            }
            // Step 2: assign the single correct role based on element purpose
            if (/\baria-expanded\b/i.test(fixed)) {
                // Accordion/expander toggle — correct semantic role is "button"
                if (roleMatches.length <= 1) fixed = fixed.replace(/\s*\brole=["'][^"']*["']/gi, "");
                fixed = fixed.replace(/^(<[a-z][a-z0-9]*\b[^>]*?)(>)/i, '$1 role="button"$2');
            } else if (roleMatches.length <= 1) {
                // Non-accordion with a single bad role="application" — remove it entirely
                fixed = fixed.replace(/\s*\brole=["']application["']/gi, "");
            }
            // If duplicate roles + no aria-expanded: roles already stripped in Step 1 ✓
            break;
        }
        case "aria-roles": {
            // Replace any invalid ARIA role with the correct semantic equivalent.
            // MUST match MASTER_PROMPT [aria-roles] rule: content cards → role="article".
            // role="region" is a landmark reserved for major uniquely-named page sections —
            // NEVER for product cards, info tiles, disability panels, or any repeating card.
            //
            // isContentCard covers all common card container tags across real websites:
            //   div, section, article, li — standard card containers
            //   a — cards-as-links (Bootstrap cards, Tailwind grids, e-commerce tiles)
            //   figure — media cards (image + caption patterns)
            //
            // Guard: if the element already has a valid ARIA role that is just being
            // misused (e.g. role="tabpanel" on a div that also has role="navigation"),
            // prefer removing only the conflicting/duplicate role rather than replacing.
            const validAriaRoles = /^(main|navigation|search|banner|contentinfo|complementary|form|region|tabpanel|dialog|alertdialog|tab|tablist|listbox|option|tree|treeitem|grid|gridcell|row|rowgroup|columnheader|rowheader|menu|menubar|menuitem|menuitemcheckbox|menuitemradio|radiogroup|combobox|listitem|article|definition|note|status|log|marquee|timer|alert|progressbar|scrollbar|separator|slider|spinbutton|textbox|checkbox|radio|button|link|img|figure|heading|math|presentation|none)$/;
            const currentRoleMatch = fixed.match(/\brole=["']([^"']+)["']/i);
            const currentRole = currentRoleMatch ? currentRoleMatch[1].trim() : "";
            const isContentCard = /^<(?:div|section|article|li|a|figure)\b/i.test(fixed);

            if (isContentCard) {
                // Content card / info panel / tile — always role="article".
                // Consistent with MASTER_PROMPT. Prevents mixed role="region"/role="article"
                // siblings on any website regardless of CMS or framework.
                fixed = fixed.replace(/\brole=["'][^"']*["']/gi, 'role="article"');
            } else if (currentRole && validAriaRoles.test(currentRole)) {
                // The existing role is semantically valid — axe flagged a DIFFERENT issue
                // on this element. Do not replace the valid role; let Gemini handle the
                // actual violation. Offline fallback: leave role as-is.
                // (No change to fixed — intentional.)
            } else if (/\baria-label\s*=/i.test(fixed)) {
                // Non-card element with a meaningful accessible name — a named region is valid
                fixed = fixed.replace(/\brole=["'][^"']*["']/gi, 'role="region"');
            } else {
                // Non-card element with no accessible name — landmark requires a label; remove role
                fixed = fixed.replace(/\s*\brole=["'][^"']*["']/gi, "");
            }
            break;
        }
    }

    return fixed;
}

// ─── OUTPUT CLEANER ─────────────────────────────────────────────────────────
function cleanGeminiOutput(raw: string): string {
    let text = raw.trim();
    // Strip code fences of any language
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    // If there's text before the first HTML tag, strip it
    const lines = text.split("\n");
    const firstTagLine = lines.findIndex(l => l.trim().startsWith("<"));
    if (firstTagLine > 0) text = lines.slice(firstTagLine).join("\n").trim();
    // Strip trailing explanatory sentences (lines with no HTML tags after content)
    const outLines = text.split("\n");
    while (outLines.length > 0) {
        const last = outLines[outLines.length - 1].trim();
        if (last && !last.includes("<") && /^[A-Z]/.test(last)) {
            outLines.pop();
        } else break;
    }
    return outLines.join("\n").trim();
}

// ─── MULTI-MODEL GEMINI CALLER ──────────────────────────────────────────────
async function callGeminiWithFallback(apiKey: string, contentParts: unknown[], temperature = 0.1): Promise<string> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
    let lastError: unknown;
    for (const modelName of models) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { temperature } });
            const result = await model.generateContent(contentParts as never[]);
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
async function applyGeminiFix(violation: AxeViolation, nodeHtml: string, pageContext?: { h1?: string; metaDescription?: string; ogTitle?: string; nearestText?: string }): Promise<HealResponse> {
    const normalizedOriginal = normalizeToDom(nodeHtml);
    const trimmedLower = normalizedOriginal.trim().toLowerCase();

    if (trimmedLower.startsWith("<html") || trimmedLower.startsWith("<body")) {
        if (violation.id === "landmark-one-main") {
            return { original: normalizedOriginal, fixed: normalizedOriginal, strategy: "heuristic-fallback", description: "Wrap your page's main content in <main>…</main> manually. Place it after your <header> and before your <footer>." };
        }
        if (violation.id !== "document-title" && violation.id !== "html-has-lang" && violation.id !== "html-lang-valid") {
            return { original: normalizedOriginal, fixed: normalizedOriginal, strategy: "heuristic-fallback", description: "Structural tags must be fixed manually in the right pane." };
        }
    }

    // Deterministic bypass: these rules are handled perfectly by the offline heuristic.
    // Sending them to Gemini causes structural corruption (double <head> injection for
    // document-title, no-op returns for html-has-lang after the guard above).
    // v20.1: redundant-button-role and aria-pressed-static added to bypassGemini.
    // Both are 100% deterministic — Gemini adds zero value and introduces variance.
    // When not bypassed: Gemini may return unchanged output, causing offlineFixed === normalizedOriginal,
    // which means the switch case never fires and the fix is silently skipped.
    // Both offline switch cases exist and are correct (v19). This change ensures they always run.
    // v20.1b: color-contrast-inline added to bypassGemini — fully deterministic inline style fix.
    const bypassGemini = ['document-title', 'aria-valid-attr-value', 'aria-allowed-attr', 'redundant-button-role', 'aria-pressed-static', 'color-contrast-inline'];
    if (bypassGemini.includes(violation.id)) {
        const offlineFixed = applyOfflineFix(violation, normalizedOriginal, pageContext);
        if (offlineFixed !== normalizedOriginal) {
            return { original: normalizedOriginal, fixed: offlineFixed, strategy: "heuristic-fallback", description: "Deterministic fix applied — Gemini bypassed to prevent structural corruption." };
        }
        return { original: normalizedOriginal, fixed: normalizedOriginal, strategy: "heuristic-fallback", description: "No automated fix available for this pattern. Edit the right pane manually." };
    }

    const isImageAlt = violation.id === "image-alt" && /<img\s/i.test(normalizedOriginal) && !/\balt=/i.test(normalizedOriginal);
    // v11 — Bug A Fix 1: opaque CDN images flagged as image-alt-filename (Unsplash photo-NNN,
    // UUIDs, CDN hashes) must use the vision path. The text Gemini prompt cannot see the image.
    // deriveAltFromFilename returns null for these URLs (no file extension before ?params).
    // The offline PATTERN 4 fallback then writes alt="" role="presentation" — wrong for hero images.
    // Condition: violation is image-alt-filename AND img tag present AND src is HTTP AND
    // deriveAltFromFilename(src) === null (opaque — UUID/hash/no-extension CDN path).
    // Non-opaque image-alt-filename violations (readable filenames) are unaffected — they still
    // go through text Gemini + MASTER_PROMPT [image-alt-filename] rule as before.
    const isOpaqueCdnImageAlt = violation.id === "image-alt-filename" &&
        /<img\s/i.test(normalizedOriginal) &&
        (() => {
            const src = (normalizedOriginal.match(/\bsrc=["']([^"']+)["']/i) ?? [])[1] ?? "";
            return src.startsWith("http") && deriveAltFromFilename(src) === null;
        })();
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey) {
        const MAX_SNIPPET = 800;
        const safeSnippet = normalizedOriginal.length > MAX_SNIPPET ? normalizedOriginal.slice(0, MAX_SNIPPET) + "\n...[truncated]..." : normalizedOriginal;

        // v11: fetch image for missing-alt (isImageAlt) AND opaque CDN bad-alt (isOpaqueCdnImageAlt).
        let imagePart: { inlineData: { data: string; mimeType: string } } | null = null;
        if (isImageAlt || isOpaqueCdnImageAlt) {
            const srcMatch = nodeHtml.match(/src=["']([^"']+)["']/i);
            if (srcMatch?.[1]) imagePart = await fetchImageAsBase64(srcMatch[1]);
        }
        // v11 — Preemptive mitigation: if the CDN blocks server-side fetches (imagePart === null)
        // for an opaque CDN image, skip Gemini entirely. VISION_PROMPT with no actual image
        // produces hallucinated or unchanged output. The offline fallback with pageContext.h1
        // (extended in Fix A-4 below) is the correct path for this case.
        //
        // v16 — Extended to image-alt (missing alt) when fetch also fails.
        // When isImageAlt=true and imagePart=null: image is on a CDN that blocks server-side
        // fetches. The text Gemini path (MASTER_PROMPT) cannot see the image either — it may
        // return the page h1 as alt (e.g. "TechGadgets Store image") which is WRONG.
        // Skip to offline fallback which uses honest empty alt + role="presentation".
        // This matches v8.1 behavior: vision path or nothing for missing-alt images.
        const shouldSkipGemini = (isOpaqueCdnImageAlt && !imagePart) || (isImageAlt && !imagePart);

        // For document-title: inject real page content so Gemini generates a specific,
        // meaningful title instead of a generic guess. ogTitle is included because most
        // real websites (WordPress, Shopify, SPAs) set og:title even when <title> is empty.
        // For all other violations: pageContextBlock is empty string — prompt unchanged.
        const pageContextBlock = (violation.id === "document-title" && pageContext)
            ? `\nPAGE CONTEXT (use this to generate the title — do not invent):\n${pageContext.h1 ? `- h1: ${pageContext.h1}\n` : ""
            }${pageContext.metaDescription ? `- meta description: ${pageContext.metaDescription}\n` : ""
            }${pageContext.ogTitle ? `- og:title: ${pageContext.ogTitle}\n` : ""}`
            : "";
        // v11: isVisionPath covers both missing-alt (isImageAlt) and opaque CDN bad-alt (isOpaqueCdnImageAlt).
        // When imagePart is non-null, VISION_PROMPT is used and Gemini describes what it actually sees.
        // When imagePart is null (fetch failed), promptText falls through to MASTER_PROMPT text path —
        // but shouldSkipGemini (set above) will prevent this block from executing in the CDN-blocked case,
        // so the text path only runs for isImageAlt with a failed fetch (existing behaviour, unchanged).
        const isVisionPath = isImageAlt || isOpaqueCdnImageAlt;
        const promptText = (isVisionPath && imagePart)
            ? VISION_PROMPT + safeSnippet.trim()
            : `${MASTER_PROMPT}\n\nVIOLATION: ${violation.id}\nDESCRIPTION: ${violation.help}${pageContextBlock}\n\nHTML TO FIX:\n${safeSnippet.trim()}`;

        const contentParts: unknown[] = imagePart ? [promptText, imagePart] : [promptText];

        if (!shouldSkipGemini) {
            try {
                const fixedHtml = await callGeminiWithFallback(apiKey, contentParts);
                if (fixedHtml && fixedHtml !== normalizedOriginal.trim()) {
                    // v19: Post-Gemini cleanup — strip redundant role="button" and normalize aria-pressed on <button> elements
                    const cleanedFixed = (() => {
                        let c = fixedHtml.replace(/\s*\brole=["']button["']/gi, "");
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
                        original: normalizedOriginal, fixed: cleanedFixed, strategy: "gemini",
                        // v11: unified description for both vision-path branches
                        description: isVisionPath
                            ? (imagePart ? "AI Vision: alt text generated by Gemini seeing the actual image" : "AI: alt text inferred from image URL")
                            : `AI fix applied for: ${violation.help}`,
                    };
                }
            } catch {
                // All Gemini models exhausted — fall through to offline
            }
        }
    }

    const offlineFixed = applyOfflineFix(violation, normalizedOriginal, pageContext);
    if (offlineFixed !== normalizedOriginal.trim()) {
        return { original: normalizedOriginal, fixed: offlineFixed, strategy: "heuristic-fallback", description: "AI quota exhausted — heuristic fix applied. Review before applying." };
    }
    return { original: normalizedOriginal, fixed: normalizedOriginal, strategy: "heuristic-fallback", description: "No automated fix available for this pattern. Edit the right pane manually." };
}

// ─── ROUTE HANDLER ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    let body: Partial<HealRequest>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

    const { violation, nodeHtml, pageContext } = body;
    if (!violation || !nodeHtml) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

    try {
        const result = await applyGeminiFix(violation, nodeHtml, pageContext);
        return NextResponse.json(result);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: `Heal failed: ${message}` }, { status: 500 });
    }
}

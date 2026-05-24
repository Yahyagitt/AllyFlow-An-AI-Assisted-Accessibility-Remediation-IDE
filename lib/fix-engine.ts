/**
 * AllyFlow Fix Engine — Deterministic structural fixes using JSDOM.
 * Handles violations that don't require semantic understanding.
 * Per allyflow-logic.md: Use JSDOM for structural changes, Gemini ONLY for semantic text.
 */
import { JSDOM } from "jsdom";

export interface FixResult {
    fixedHtml: string;
    strategy: "jsdom" | "gemini";
    description: string;
}

/**
 * Violation IDs that can be fixed deterministically without AI.
 * Maps axe-core rule id → fix function.
 * Returns null to explicitly delegate to Gemini.
 */
const STRUCTURAL_FIXERS: Record<
    string,
    (node: Element, dom: JSDOM) => string | null
> = {

    // ── Language ──────────────────────────────────────────────────────────────
    "html-has-lang": (node) => {
        node.setAttribute("lang", "en");
        return node.outerHTML;
    },

    "html-lang-valid": (node) => {
        node.setAttribute("lang", "en");
        return node.outerHTML;
    },

    // ── Landmarks ────────────────────────────────────────────────────────────
    "region": (node) => {
        if (!node.getAttribute("role")) {
            node.setAttribute("role", "region");
            node.setAttribute("aria-label", "Content region");
        }
        return node.outerHTML;
    },

    // ── Buttons ──────────────────────────────────────────────────────────────
    "button-name": (node) => {
        if (!node.getAttribute("aria-label") && !node.getAttribute("aria-labelledby")) {
            const text = node.textContent?.trim();
            // Derive label from inner text, or fall back to type hint
            const type = node.getAttribute("type") ?? "";
            const label = text || (type === "submit" ? "Submit" : type === "reset" ? "Reset form" : "Button");
            node.setAttribute("aria-label", label);
        }
        return node.outerHTML;
    },

    // ── Links ────────────────────────────────────────────────────────────────
    "link-name": (node) => {
        if (!node.getAttribute("aria-label") && !node.getAttribute("aria-labelledby")) {
            const text = node.textContent?.trim();
            const href = node.getAttribute("href") ?? "";
            const genericPhrases = /^(click here|read more|learn more|more|here|link|click|go|see more|view more|details|info|this)$/i;

            if (!text || genericPhrases.test(text)) {
                // Derive label from href path
                let label = "Link";
                try {
                    const segment = href.split("/").filter(Boolean).pop()?.split("?")[0] ?? "";
                    if (segment && !/^https?:$/.test(segment)) {
                        label = segment.replace(/[-_]/g, " ").replace(/\.[^.]+$/, "").trim() || "Link";
                    }
                } catch { /* keep "Link" */ }
                node.setAttribute("aria-label", label);
            } else {
                node.setAttribute("aria-label", text);
            }
        }
        return node.outerHTML;
    },

    // ── Forms ─────────────────────────────────────────────────────────────────
    "label": (node, dom) => {
        // Inputs
        if (node.tagName.toLowerCase() === "input") {
            if (!node.getAttribute("aria-label") && !node.getAttribute("aria-labelledby")) {
                const placeholder = node.getAttribute("placeholder");
                const type = node.getAttribute("type") ?? "";
                const name = node.getAttribute("name") ?? "";
                const id = node.getAttribute("id");
                const safeTypes = new Set(["text", "email", "password", "search", "tel", "url", "number", "date"]);
                const labelText =
                    placeholder ||
                    (safeTypes.has(type) ? type.charAt(0).toUpperCase() + type.slice(1) + " field" : null) ||
                    (name ? name.replace(/[-_]/g, " ").replace(/([A-Z])/g, " $1").trim() : null) ||
                    (id ? id.replace(/[-_]/g, " ").replace(/([A-Z])/g, " $1").trim() : null) ||
                    "Input field";
                node.setAttribute("aria-label", labelText);
            }
            return node.outerHTML;
        }
        // Selects
        if (node.tagName.toLowerCase() === "select") {
            if (!node.getAttribute("aria-label") && !node.getAttribute("aria-labelledby")) {
                const name = node.getAttribute("name") ?? "";
                const id = node.getAttribute("id") ?? "";
                const labelText = (name || id).replace(/[-_]/g, " ").replace(/([A-Z])/g, " $1").trim() || "Select option";
                node.setAttribute("aria-label", labelText);
            }
            return node.outerHTML;
        }
        // Textareas
        if (node.tagName.toLowerCase() === "textarea") {
            if (!node.getAttribute("aria-label") && !node.getAttribute("aria-labelledby")) {
                const placeholder = node.getAttribute("placeholder");
                const name = node.getAttribute("name") ?? "";
                const labelText = placeholder || (name ? name.replace(/[-_]/g, " ").trim() : null) || "Text area";
                node.setAttribute("aria-label", labelText);
            }
            return node.outerHTML;
        }
        // Fallback: wrap in a generated label using JSDOM
        const inputId = node.getAttribute("id") || `input-${Date.now()}`;
        if (!node.getAttribute("id")) {
            node.setAttribute("id", inputId);
        }
        const placeholder = node.getAttribute("placeholder") || "Input field";
        const label = dom.window.document.createElement("label");
        label.setAttribute("for", inputId);
        label.textContent = placeholder;
        return `${label.outerHTML}\n${node.outerHTML}`;
    },

    // ── Images ────────────────────────────────────────────────────────────────
    // Delegate to Gemini for all image alt text — needs semantic understanding
    "image-alt": () => null,

    // ── Page title ────────────────────────────────────────────────────────────
    "document-title": (node) => {
        if (!node.textContent?.trim()) {
            node.textContent = "Page Title";
        }
        return node.outerHTML;
    },

    // ── Skip links ────────────────────────────────────────────────────────────
    "skip-link": (node) => {
        node.setAttribute("href", "#main-content");
        return node.outerHTML;
    },

    // ── ARIA ──────────────────────────────────────────────────────────────────
    "aria-required-attr": (node) => {
        const role = node.getAttribute("role");
        if (role === "checkbox" || role === "radio") {
            if (!node.getAttribute("aria-checked")) node.setAttribute("aria-checked", "false");
        }
        if (role === "combobox") {
            if (!node.getAttribute("aria-expanded")) node.setAttribute("aria-expanded", "false");
            if (!node.getAttribute("aria-controls")) node.setAttribute("aria-controls", "listbox");
        }
        if (role === "slider") {
            if (!node.getAttribute("aria-valuenow")) node.setAttribute("aria-valuenow", "0");
            if (!node.getAttribute("aria-valuemin")) node.setAttribute("aria-valuemin", "0");
            if (!node.getAttribute("aria-valuemax")) node.setAttribute("aria-valuemax", "100");
        }
        if (role === "progressbar") {
            if (!node.getAttribute("aria-valuenow")) node.setAttribute("aria-valuenow", "0");
            if (!node.getAttribute("aria-valuemin")) node.setAttribute("aria-valuemin", "0");
            if (!node.getAttribute("aria-valuemax")) node.setAttribute("aria-valuemax", "100");
        }
        return node.outerHTML;
    },

    "aria-valid-attr-value": (node) => {
        // Fix yes/no → true/false for boolean ARIA attributes
        const boolAttrs = ["aria-pressed", "aria-expanded", "aria-checked", "aria-hidden", "aria-selected", "aria-disabled"];
        for (const attr of boolAttrs) {
            const val = node.getAttribute(attr);
            if (val === "yes") node.setAttribute(attr, "true");
            if (val === "no") node.setAttribute(attr, "false");
        }
        return node.outerHTML;
    },

    "aria-allowed-attr": (node) => {
        const boolAttrs = ["aria-pressed", "aria-expanded", "aria-checked", "aria-hidden", "aria-selected", "aria-disabled"];
        for (const attr of boolAttrs) {
            const val = node.getAttribute(attr);
            if (val === "yes") node.setAttribute(attr, "true");
            if (val === "no") node.setAttribute(attr, "false");
        }
        return node.outerHTML;
    },

    "aria-hidden-focus": (node) => {
        // Remove aria-hidden from natively focusable elements
        const focusableTags = new Set(["a", "button", "input", "select", "textarea"]);
        if (focusableTags.has(node.tagName.toLowerCase())) {
            node.removeAttribute("aria-hidden");
        }
        return node.outerHTML;
    },

    // ── IDs ───────────────────────────────────────────────────────────────────
    "duplicate-id-active": (node) => {
        const currentId = node.getAttribute("id");
        if (currentId) {
            node.setAttribute("id", `${currentId}-fixed`);
        }
        return node.outerHTML;
    },

    "duplicate-id-aria": (node) => {
        const currentId = node.getAttribute("id");
        if (currentId) {
            node.setAttribute("id", `${currentId}-aria-fixed`);
        }
        return node.outerHTML;
    },

    // ── Iframes ───────────────────────────────────────────────────────────────
    "frame-title": (node) => {
        if (!node.getAttribute("title")) {
            const src = node.getAttribute("src") ?? "";
            let title = "Embedded content";
            if (src.includes("youtube.com") || src.includes("youtu.be")) title = "YouTube video player";
            else if (src.includes("google.com/maps") || src.includes("maps.google")) title = "Google Maps";
            else if (src.includes("vimeo.com")) title = "Vimeo video player";
            else if (src) {
                try {
                    const segment = src.split("/").filter(Boolean).pop()?.split("?")[0] ?? "";
                    title = segment.replace(/[-_]/g, " ").replace(/\.[^.]+$/, "").trim() || "Embedded content";
                } catch { /* keep default */ }
            }
            node.setAttribute("title", title);
        }
        return node.outerHTML;
    },

    // ── Keyboard / Focus ──────────────────────────────────────────────────────
    "scrollable-region-focusable": (node) => {
        if (!node.getAttribute("tabindex")) {
            node.setAttribute("tabindex", "0");
        }
        return node.outerHTML;
    },

    // ── Tables ────────────────────────────────────────────────────────────────
    "table-duplicate-name": (node) => {
        // Remove caption if it duplicates the summary
        const caption = node.querySelector("caption");
        const summary = node.getAttribute("summary");
        if (caption && summary && caption.textContent?.trim() === summary.trim()) {
            node.removeAttribute("summary");
        }
        return node.outerHTML;
    },

    "th-has-data-cells": (node) => {
        // Add scope attribute if missing
        if (!node.getAttribute("scope")) {
            node.setAttribute("scope", "col");
        }
        return node.outerHTML;
    },

    // ── Lists ────────────────────────────────────────────────────────────────
    "list": (node) => {
        // Remove non-li/script/template direct children from ul/ol
        const children = Array.from(node.children);
        for (const child of children) {
            const tag = child.tagName.toLowerCase();
            if (tag !== "li" && tag !== "script" && tag !== "template") {
                child.remove();
            }
        }
        return node.outerHTML;
    },

    "listitem": (node) => {
        // <li> not inside a ul/ol — wrap it
        return `<ul>${node.outerHTML}</ul>`;
    },
};

/**
 * Checks whether a given axe violation id has a deterministic JSDOM fix.
 */
export function isStructuralViolation(violationId: string): boolean {
    return violationId in STRUCTURAL_FIXERS;
}

/**
 * Applies a deterministic JSDOM fix to the given HTML snippet.
 * Returns null if this violation should be handled by Gemini instead.
 */
export function applyStructuralFix(
    violationId: string,
    htmlSnippet: string
): FixResult | null {
    const fixer = STRUCTURAL_FIXERS[violationId];
    if (!fixer) return null;

    try {
        const dom = new JSDOM(`<body>${htmlSnippet}</body>`);
        const node = dom.window.document.body.firstElementChild;
        if (!node) return null;

        const result = fixer(node, dom);
        if (result === null) return null; // Explicitly delegated to Gemini

        return {
            fixedHtml: result,
            strategy: "jsdom",
            description: `Structural fix applied via JSDOM for rule: ${violationId}`,
        };
    } catch {
        return null;
    }
}

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
 */
const STRUCTURAL_FIXERS: Record<
    string,
    (node: Element, dom: JSDOM) => string | null
> = {
    // Missing lang attribute on <html>
    "html-has-lang": (node) => {
        node.setAttribute("lang", "en");
        return node.outerHTML;
    },

    // <html lang=""> empty lang
    "html-lang-valid": (node) => {
        node.setAttribute("lang", "en");
        return node.outerHTML;
    },

    // Missing role on landmark regions
    "region": (node) => {
        if (!node.getAttribute("role")) {
            node.setAttribute("role", "region");
            node.setAttribute("aria-label", "Content region");
        }
        return node.outerHTML;
    },

    // Buttons without accessible names get aria-label
    "button-name": (node) => {
        if (!node.getAttribute("aria-label") && !node.getAttribute("aria-labelledby")) {
            const text = node.textContent?.trim();
            node.setAttribute("aria-label", text || "Button");
        }
        return node.outerHTML;
    },

    // Links without accessible names
    "link-name": (node) => {
        if (!node.getAttribute("aria-label") && !node.getAttribute("aria-labelledby")) {
            const text = node.textContent?.trim();
            node.setAttribute("aria-label", text || "Link");
        }
        return node.outerHTML;
    },

    // Inputs without associated labels
    "label": (node, dom) => {
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

    // Missing document title
    "document-title": (node) => {
        if (!node.textContent?.trim()) {
            node.textContent = "Page Title";
        }
        return node.outerHTML;
    },

    // Images with empty alt (role="presentation" is valid for decorative)
    // We only handle the structural case; alt text content goes to Gemini
    "image-alt": () => null, // → delegate to Gemini

    // Skip-link target
    "skip-link": (node) => {
        node.setAttribute("href", "#main-content");
        return node.outerHTML;
    },

    // Missing ARIA required attributes — add sensible defaults
    "aria-required-attr": (node) => {
        const role = node.getAttribute("role");
        if (role === "checkbox" || role === "radio") {
            if (!node.getAttribute("aria-checked")) {
                node.setAttribute("aria-checked", "false");
            }
        }
        if (role === "combobox") {
            if (!node.getAttribute("aria-expanded")) {
                node.setAttribute("aria-expanded", "false");
            }
        }
        return node.outerHTML;
    },

    // Duplicate IDs — append suffix
    "duplicate-id-active": (node) => {
        const currentId = node.getAttribute("id");
        if (currentId) {
            node.setAttribute("id", `${currentId}-fixed`);
        }
        return node.outerHTML;
    },
};

/**
 * Checks whether a given axe violation id has a deterministic JSDOM fix.
 */
export function isStructuralViolation(violationId: string): boolean {
    const fixer = STRUCTURAL_FIXERS[violationId];
    if (!fixer) return false;
    // If fixer returns null it explicitly delegates to Gemini
    return true;
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

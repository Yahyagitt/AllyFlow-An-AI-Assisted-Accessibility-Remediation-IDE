// Shared types for the AllyFlow scan API.
// Kept separate so client components can import types without pulling in server modules.

export interface AxeViolation {
    id: string;
    impact: "critical" | "serious" | "moderate" | "minor" | null;
    description: string;
    help: string;
    helpUrl: string;
    tags: string[];
    nodes: Array<{
        html: string;
        failureSummary: string;
        target: string[];
    }>;
}

export interface ScanResponse {
    url: string;
    rawHtml: string;       // The untouched HTML containing original scripts
    sanitizedHtml: string; // The safe HTML for the IDE and AI
    violations: AxeViolation[];
    passes: number;
    seoResults: SeoCheck[];
    timestamp: string;
}

export interface HealResponse {
    original: string;
    fixed: string;
    strategy: "gemini" | "heuristic-fallback";
    description: string;
    /**
     * When "html-tag-regex", the client patches the <html> opening tag
     * by adding/replacing the lang attribute rather than doing a literal
     * string replacement (which fails because puppeteer mutates the tag).
     * `fixed` holds the desired lang value (e.g. "en").
     */
    patchType?: "html-tag-regex";
}

export interface SeoCheck {
    id: string;
    status: "pass" | "fail";
    title: string;
    description: string;
    actualValue: string;
}

export type HealStatus = "idle" | "healing" | "done" | "error";

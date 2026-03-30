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
    sanitizedHtml: string;
    violations: AxeViolation[];
    passes: number;
    timestamp: string;
}

export interface HealResponse {
    original: string;
    fixed: string;
    strategy: "jsdom" | "gemini";
    description: string;
}

export type HealStatus = "idle" | "healing" | "done" | "error";

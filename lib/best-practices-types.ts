// Shared types for the AllyFlow Best Practices scanner.
// Kept separate so client components can import types without pulling in server modules.

export interface BestPracticeViolation {
    id: string;
    category: "motor" | "cognitive" | "screen-reader";
    severity: "serious" | "moderate";
    title: string;
    description: string;
    wcagRef: string;
    nodes: { html: string; selector: string; fix: string }[];
}

export interface BestPracticesResponse {
    violations: BestPracticeViolation[];
    timestamp: string;
}

export interface BestPracticesHealRequest {
    violation: BestPracticeViolation;
    nodeHtml: string;
}

export interface BestPracticesHealResponse {
    original: string;
    fixed: string;
    strategy: "gemini" | "heuristic-fallback";
    description: string;
}

/** Human-readable label for a violation category */
export function categoryLabel(cat: string): string {
    switch (cat) {
        case "motor": return "Motor Accessibility";
        case "cognitive": return "Cognitive Accessibility";
        case "screen-reader": return "Screen Reader";
        default: return "Accessibility";
    }
}

/** Tailwind badge color classes for each category */
export function categoryColor(cat: string): string {
    switch (cat) {
        case "motor": return "bg-orange-500/10 text-orange-400 border-orange-500/20";
        case "cognitive": return "bg-purple-500/10 text-purple-400 border-purple-500/20";
        case "screen-reader": return "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
        default: return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    }
}

/** Icon emoji for each category */
export function categoryIcon(cat: string): string {
    switch (cat) {
        case "motor": return "🕹";
        case "cognitive": return "🧠";
        case "screen-reader": return "👁";
        default: return "♿";
    }
}

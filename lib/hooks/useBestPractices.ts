"use client";

import { useState, useCallback } from "react";
import type { BestPracticeViolation, BestPracticesResponse } from "@/lib/best-practices-types";

interface UseBestPracticesReturn {
    violations: BestPracticeViolation[];
    loading: boolean;
    error: string | null;
    refetch: (html: string, url: string) => Promise<void>;
    grouped: Record<string, BestPracticeViolation[]>;
}

export function useBestPractices(): UseBestPracticesReturn {
    const [violations, setViolations] = useState<BestPracticeViolation[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refetch = useCallback(async (html: string, url: string) => {
        setLoading(true);
        setError(null);
        setViolations([]);

        try {
            const res = await fetch("/api/best-practices", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ html, url }),
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || `HTTP ${res.status}`);
            }

            const data: BestPracticesResponse = await res.json();
            setViolations(data.violations);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Best practices scan failed";
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    // Group violations by category
    const grouped = violations.reduce<Record<string, BestPracticeViolation[]>>((acc, v) => {
        if (!acc[v.category]) acc[v.category] = [];
        acc[v.category].push(v);
        return acc;
    }, {});

    return { violations, loading, error, refetch, grouped };
}

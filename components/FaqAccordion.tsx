"use client";

import { useState, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const FAQ_ITEMS = [
    {
        q: "Can I use AllyFlow offline?",
        a: "Partially. The axe-core audit and heuristic fix engine work entirely offline. AI-powered fixes require the Gemini API. When Gemini is unavailable or quota is exhausted, the offline engine kicks in automatically with deterministic structural fixes.",
    },
    {
        q: "Does AllyFlow modify my live website?",
        a: "No. The Hibernation Method surgically disables scripts and event handlers before scanning. No accidental form submissions, state mutations, or side effects. The original behaviour is fully restored on export. Every fix requires explicit developer approval.",
    },
    {
        q: "What accessibility standards does it check?",
        a: "AllyFlow runs axe-core 4.11 with WCAG 2.1 AA rules, plus a best-practices engine covering motor, cognitive, and screen-reader disability categories. An SEO health check runs alongside every audit.",
    },
    {
        q: "Can I audit pages behind a login or VPN?",
        a: "Not directly via URL scanning. You can upload the HTML file of any page (including behind auth) using the file upload feature, and the full audit and fix pipeline works identically.",
    },
    {
        q: "Is my data sent to an external API?",
        a: "The URL or HTML content you submit is sent to your browser's local Next.js server for axe-core processing. AI fix generation sends the relevant HTML snippet to Google's Gemini API. No data is stored on any server — scan results are session-only.",
    },
];

const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

function FaqItem({ item, isOpen, onToggle }: { item: typeof FAQ_ITEMS[number]; isOpen: boolean; onToggle: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    function handleMove(e: React.MouseEvent<HTMLDivElement>) {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        ref.current.style.transform = `perspective(600px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg)`;
    }
    function handleLeave() {
        if (!ref.current) return;
        ref.current.style.transform = "perspective(600px) rotateY(0deg) rotateX(0deg)";
    }
    return (
        <div
            ref={ref}
            onMouseMove={handleMove}
            onMouseLeave={handleLeave}
            className="group relative overflow-hidden border-b border-white/[0.06]"
            style={{ transition: "box-shadow 0.5s cubic-bezier(0.16, 1, 0.3, 1), translate 0.5s cubic-bezier(0.16, 1, 0.3, 1)" }}
        >
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{
                    padding: "1px",
                    background: "linear-gradient(135deg, rgba(34,34,227,0.3), rgba(59,130,246,0.08), rgba(34,34,227,0.3))",
                    WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                }}
            />
            <button
                onClick={onToggle}
                className="flex w-full items-center justify-between py-4 sm:py-5 text-left text-sm font-medium text-slate-300 hover:text-slate-100 transition-colors duration-300 px-2"
                style={{ transitionTimingFunction: EASING }}
                aria-expanded={isOpen}
            >
                <span>{item.q}</span>
                <ChevronDown
                    className={cn(
                        "h-4 w-4 flex-shrink-0 ml-4 text-slate-500 transition-transform duration-300",
                        isOpen && "rotate-180"
                    )}
                    style={{ transitionTimingFunction: EASING }}
                />
            </button>
            <div
                className={cn(
                    "grid transition-all duration-500 ease-in-out",
                    isOpen ? "grid-rows-[1fr] pb-4 sm:pb-5" : "grid-rows-[0fr]"
                )}
                style={{ transitionTimingFunction: EASING }}
            >
                <div className="overflow-hidden">
                    <div
                        className={cn(
                            "text-sm text-slate-400 leading-relaxed transition-opacity duration-500 px-2",
                            isOpen ? "opacity-100" : "opacity-0"
                        )}
                        style={{ transitionTimingFunction: EASING }}
                    >
                        {item.a}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function FaqAccordion() {
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    return (
        <div className="mx-auto max-w-2xl">
            {FAQ_ITEMS.map((item, i) => (
                <FaqItem
                    key={i}
                    item={item}
                    isOpen={openIndex === i}
                    onToggle={() => setOpenIndex(openIndex === i ? null : i)}
                />
            ))}
        </div>
    );
}

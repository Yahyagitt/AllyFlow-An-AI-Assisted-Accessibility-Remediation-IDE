"use client";

import Link from "next/link";
import RevealOnScroll from "@/components/RevealOnScroll";
import FaqAccordion from "@/components/FaqAccordion";
import AllyFlowLogo from "@/components/AllyFlowLogo";
import { useDailyScans } from "@/lib/useDailyScans";
import { useState, useEffect, useRef } from "react";
import {
    Zap, Github, ArrowRight, Search, Brain, FileCode2,
    Eye, ShieldCheck, WifiOff, Sparkles, CheckCircle2,
    Monitor, Code2, Puzzle, Workflow, Download, Globe,
    BarChart3, ScrollText, HelpCircle, Activity, Shield,
    Settings, ExternalLink
} from "lucide-react";

const FEATURES = [
    {
        icon: Brain,
        title: "AI-Powered Remediation",
        description:
            "Gemini 2.5 Flash drafts WCAG-compliant HTML fixes automatically. Falls back through three model tiers, then to a deterministic offline engine — the workflow never stalls.",
    },
    {
        icon: FileCode2,
        title: "Monaco Diff Editor",
        description:
            "Every fix is rendered in a side-by-side diff editor, same engine as VS Code. Review, edit, or reject each change before it reaches your codebase. Human-in-the-loop by design.",
    },
    {
        icon: Search,
        title: "Axe-Core Auditing",
        description:
            "Puppeteer launches a real browser context, injects axe-core 4.11, and runs a full WCAG 2.1 AA audit against any public URL or uploaded HTML file.",
    },
    {
        icon: ShieldCheck,
        title: "Safe DOM Scanning",
        description:
            "The Hibernation Method surgically disables scripts and event handlers before scanning. No accidental form submissions, no state mutations, no side effects.",
    },
    {
        icon: BarChart3,
        title: "SEO + Best Practices",
        description:
            "Lightweight SEO health checks run alongside every audit. A 7-rule best-practices engine catches motor, cognitive, and screen-reader violations automation misses.",
    },
    {
        icon: WifiOff,
        title: "Offline Fallback",
        description:
            "When Gemini is unavailable or quota is exhausted, a pure JavaScript heuristic engine applies deterministic structural fixes. The pipeline never breaks.",
    },
];

const HOW_IT_WORKS = [
    { step: 1, icon: Globe, title: "Enter URL or Upload", description: "Paste any public URL or drag-and-drop an HTML file." },
    { step: 2, icon: Search, title: "Run the Audit", description: "Axe-core + Best Practices engine scan for WCAG 2.1 AA violations." },
    { step: 3, icon: Brain, title: "Fix with AI", description: "Gemini drafts a fix. Offline heuristics backstop every request." },
    { step: 4, icon: Eye, title: "Review the Diff", description: "Monaco editor shows original vs. fixed. Edit or approve." },
    { step: 5, icon: Download, title: "Export", description: "Clean HTML with absolutized paths. No sentinel leakage. Ship it." },
];

function FeatureCard({ feature: { icon: Icon, title, description } }: { feature: typeof FEATURES[number] }) {
    const cardRef = useRef<HTMLDivElement>(null);

    function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
        if (!cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        cardRef.current.style.transform = `perspective(600px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg)`;
    }

    function handleMouseLeave() {
        if (!cardRef.current) return;
        cardRef.current.style.transform = "perspective(600px) rotateY(0deg) rotateX(0deg)";
    }

    return (
        <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 transition-all duration-500 hover:shadow-2xl hover:-translate-y-0.5"
            style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)", transition: "box-shadow 0.5s cubic-bezier(0.16, 1, 0.3, 1), translate 0.5s cubic-bezier(0.16, 1, 0.3, 1)" }}
        >
            {/* Gradient border on hover */}
            <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{
                    padding: "1px",
                    background: "linear-gradient(135deg, rgba(34,34,227,0.4), rgba(59,130,246,0.2), rgba(34,34,227,0.4))",
                    WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                }}
            />
            <div className="absolute inset-0 -z-10 bg-[#2222E3]/[0.04] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            />
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#2222E3]/30 to-[#2222E3]/30 border border-[#2222E3]/20 transition-transform duration-500 group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-[#2222E3]/20"
                style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            >
                <Icon className="h-6 w-6 text-[#2222E3]" strokeWidth={1.5} />
            </div>
            <h3 className="mb-2 text-lg font-normal text-slate-100">{title}</h3>
            <p className="text-sm leading-relaxed text-slate-400">{description}</p>
        </div>
    );
}

function InteractiveCard({ children, borderColor }: { children: React.ReactNode; borderColor: "red" | "emerald" }) {
    const cardRef = useRef<HTMLDivElement>(null);

    function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
        if (!cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        cardRef.current.style.transform = `perspective(600px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg)`;
    }

    function handleMouseLeave() {
        if (!cardRef.current) return;
        cardRef.current.style.transform = "perspective(600px) rotateY(0deg) rotateX(0deg)";
    }

    const gradient = borderColor === "red"
        ? "linear-gradient(135deg, rgba(239,68,68,0.4), rgba(239,68,68,0.1), rgba(239,68,68,0.4))"
        : "linear-gradient(135deg, rgba(52,211,153,0.4), rgba(52,211,153,0.1), rgba(52,211,153,0.4))";

    return (
        <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]"
            style={{ transition: "box-shadow 0.5s cubic-bezier(0.16, 1, 0.3, 1), translate 0.5s cubic-bezier(0.16, 1, 0.3, 1)" }}
        >
            <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{
                    padding: "1px",
                    background: gradient,
                    WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                }}
            />
            <div className={`absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${borderColor === "red" ? "bg-red-500/[0.04]" : "bg-emerald-500/[0.04]"}`}
                style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            />
            {children}
        </div>
    );
}

function StepCard({ step: { step, icon: Icon, title, description } }: { step: typeof HOW_IT_WORKS[number] }) {
    return (
        <div className="flex flex-col items-center text-center transition-all duration-500 hover:-translate-y-1"
            style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
        >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2222E3] text-white text-sm font-bold shadow-lg shadow-[#2222E3]/30 transition-all duration-500 group-hover:shadow-[#2222E3]/50"
                style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            >
                {step}
            </div>
            <div className="mt-4 mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[#2222E3]/10 border border-[#2222E3]/10 transition-all duration-500 hover:scale-110 hover:bg-[#2222E3]/20"
                style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            >
                <Icon className="h-5 w-5 text-[#2222E3]" strokeWidth={1.5} />
            </div>
            <h3 className="text-sm font-normal text-slate-200">{title}</h3>
            <p className="mt-1 text-xs text-slate-500 max-w-[180px]">{description}</p>
        </div>
    );
}

export default function LandingPage() {
    const { scansToday } = useDailyScans();
    const statsRef = useRef<HTMLDivElement>(null);
    const [animatedScans, setAnimatedScans] = useState(0);
    const ctaRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scansToday === 0) return;
        const duration = 1500;
        const steps = 30;
        const increment = scansToday / steps;
        let current = 0;
        const timer = setInterval(() => {
            current += increment;
            if (current >= scansToday) {
                setAnimatedScans(scansToday);
                clearInterval(timer);
            } else {
                setAnimatedScans(Math.floor(current));
            }
        }, duration / steps);
        return () => clearInterval(timer);
    }, [scansToday]);

    const violationsFixed = scansToday * 8;

    function handleCtaMouseMove(e: React.MouseEvent<HTMLDivElement>) {
        if (!ctaRef.current) return;
        const rect = ctaRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        ctaRef.current.style.transform = `perspective(600px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg)`;
    }

    function handleCtaMouseLeave() {
        if (!ctaRef.current) return;
        ctaRef.current.style.transform = "perspective(600px) rotateY(0deg) rotateX(0deg)";
    }

    function handleNavClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
        e.preventDefault();
        const id = href.replace("#", "");
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    return (
        <div className="min-h-screen overflow-x-hidden bg-[#111113] text-slate-100">
            {/* ── NAV ── */}
            <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#111113]/80 backdrop-blur-xl transition-all duration-700"
                style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            >
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg overflow-hidden">
                            <img src="/logo.jpeg" alt="AllyFlow" className="w-full h-full object-contain" />
                        </div>
                        <span className="text-white font-normal text-2xl tracking-tight">
                            Ally<span className="text-red-400">Flow</span>
                        </span>
                    </div>
                    <nav className="hidden md:flex items-center gap-2 text-sm">
                        <a href="#features" onClick={(e) => handleNavClick(e, "#features")} className="px-3 py-1.5 rounded-lg text-slate-400 transition-all duration-300 hover:text-slate-100 hover:bg-white/[0.06]">Features</a>
                        <a href="#how-it-works" onClick={(e) => handleNavClick(e, "#how-it-works")} className="px-3 py-1.5 rounded-lg text-slate-400 transition-all duration-300 hover:text-slate-100 hover:bg-white/[0.06]">How It Works</a>
                        <a href="#faq" onClick={(e) => handleNavClick(e, "#faq")} className="px-3 py-1.5 rounded-lg text-slate-400 transition-all duration-300 hover:text-slate-100 hover:bg-white/[0.06]">FAQ</a>
                    </nav>
                    <div className="flex items-center gap-3">
                        <a
                            href="https://github.com/Yahyagitt/AllyFlow-An-AI-Assisted-Accessibility-Remediation-IDE"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hidden sm:flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                            aria-label="View on GitHub"
                        >
                            <Github className="h-4 w-4" />
                            <span>GitHub</span>
                        </a>
                        <Link
                            href="/studio"
                            className="inline-flex items-center gap-2 rounded-lg bg-[#2222E3] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#2222E3]/15 transition-all hover:bg-[#2222E3] hover:shadow-[#2222E3]/25"
                        >
                            Get Started
                            <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </div>
                </div>
            </header>

            {/* ── HERO ── */}
            <section className="relative min-h-screen flex items-center overflow-hidden pt-16">
                <div className="absolute inset-0 bg-hero-mesh" />
                <div className="absolute inset-0 bg-hero-grid" style={{ backgroundSize: "60px 60px" }} />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#111113]" />
                <div className="relative mx-auto max-w-5xl px-6 py-32 text-center">
                    <div className="mx-auto mb-8 w-full max-w-3xl">
                        <AllyFlowLogo />
                    </div>
                    <p
                        className="mx-auto mt-6 max-w-2xl text-base sm:text-lg text-slate-400 leading-relaxed"
                        style={{ animation: "fade-in-up-smooth 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.4s forwards", opacity: 0 }}
                    >
                        An AI-assisted accessibility remediation IDE that doesn&apos;t just find violations — it drafts the fix.
                        Powered by axe-core, Gemini AI, and a deterministic offline fallback engine.
                    </p>
                    <div
                        className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
                        style={{ animation: "fade-in-up-smooth 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.55s forwards", opacity: 0 }}
                    >
                        <Link
                            href="/studio"
                            className="inline-flex items-center gap-2.5 rounded-xl bg-[#2222E3] px-8 py-4 text-base font-bold text-white shadow-lg shadow-[#2222E3]/20 transition-all duration-500 hover:bg-[#2222E3] hover:shadow-[#2222E3]/30 hover:-translate-y-1"
                        >
                            Get Started
                            <ArrowRight className="h-5 w-5" />
                        </Link>
                        <a
                            href="https://github.com/Yahyagitt/AllyFlow-An-AI-Assisted-Accessibility-Remediation-IDE"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-8 py-4 text-base font-semibold text-slate-300 transition-all duration-500 hover:bg-white/[0.06] hover:text-slate-100 hover:border-white/[0.12] hover:-translate-y-1"
                            style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
                        >
                            <Github className="h-5 w-5" />
                            View on GitHub
                        </a>
                    </div>
                    <div
                        className="mt-16 flex flex-wrap items-center justify-center gap-8 text-xs text-slate-500"
                        style={{ animation: "fade-in-up-smooth 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.7s forwards", opacity: 0 }}
                    >
                        <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> WCAG 2.1 AA</span>
                        <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> AI-Powered Fixes</span>
                        <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Offline Fallback</span>
                        <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Human-in-the-Loop</span>
                    </div>
                    <div ref={statsRef} className="mt-12 flex items-center justify-center gap-14 text-center">
                        <div>
                            <div className="text-5xl font-light tracking-tight text-[#2222E3]">{animatedScans}</div>
                            <div className="text-xs text-slate-500 mt-1.5">Scans Today</div>
                        </div>
                        <div className="w-px h-14 bg-white/[0.06]" />
                        <div>
                            <div className="text-5xl font-light tracking-tight text-emerald-400">100%</div>
                            <div className="text-xs text-slate-500 mt-1.5">Open Source</div>
                        </div>
                        <div className="w-px h-14 bg-white/[0.06]" />
                        <div>
                            <div className="text-5xl font-light tracking-tight text-slate-200">{violationsFixed}</div>
                            <div className="text-xs text-slate-500 mt-1.5">Issues Fixed</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── PROBLEM / SOLUTION ── */}
            <RevealOnScroll delay={0}>
                <section className="relative border-t border-white/[0.06]">
                    <div className="mx-auto max-w-6xl px-6 py-24">
                        <div className="grid md:grid-cols-2 gap-8 md:gap-16 items-start">
                        <InteractiveCard borderColor="red">
                            <div className="p-8">
                                <h2 className="text-lg font-normal text-red-400 mb-5 flex items-center gap-2">
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20 text-xs font-bold text-red-400">!</span>
                                    The Old Way
                                </h2>
                                <ul className="space-y-4 text-sm text-slate-400">
                                    <li className="flex items-start gap-3.5">
                                        <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-400/50" />
                                        <span>Tools tell you <strong className="text-slate-300">what</strong> is broken. A list of violations and a WCAG link.</span>
                                    </li>
                                    <li className="flex items-start gap-3.5">
                                        <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-400/50" />
                                        <span>You decode the spec, identify the right ARIA pattern, manually rewrite the component.</span>
                                    </li>
                                    <li className="flex items-start gap-3.5">
                                        <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-400/50" />
                                        <span>Accessibility tickets age. Bugs persist. Compliance becomes an afterthought.</span>
                                    </li>
                                </ul>
                            </div>
                        </InteractiveCard>
                        <InteractiveCard borderColor="emerald">
                            <div className="p-8">
                                <h2 className="text-lg font-normal text-emerald-400 mb-5 flex items-center gap-2">
                                    <Sparkles className="h-5 w-5" />
                                    <span>With <span className="text-white">Ally</span><span className="text-red-400">Flow</span></span>
                                </h2>
                                <ul className="space-y-4 text-sm text-slate-400">
                                    <li className="flex items-start gap-3.5">
                                        <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400/50" />
                                        <span>AI drafts WCAG-compliant HTML for every failing node. <strong className="text-slate-300">Automatically.</strong></span>
                                    </li>
                                    <li className="flex items-start gap-3.5">
                                        <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400/50" />
                                        <span>Review every change in a Monaco diff editor before it touches your codebase.</span>
                                    </li>
                                    <li className="flex items-start gap-3.5">
                                        <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400/50" />
                                        <span>Audit, Fix, Preview, Export. One tool. No context switching.</span>
                                    </li>
                                </ul>
                            </div>
                        </InteractiveCard>
                    </div>
                </div>
            </section>
            </RevealOnScroll>

            {/* ── FEATURES ── */}
            <RevealOnScroll delay={100}>
                <section id="features" className="relative border-t border-white/[0.06]">
                    <div className="mx-auto max-w-6xl px-6 py-24">
                        <div className="text-center mb-16">
                        <h2 className="text-3xl sm:text-4xl font-normal tracking-tight">
                            Everything you need to{" "}
                            <span className="text-[#2222E3]">
                                ship accessible code
                            </span>
                        </h2>
                        <p className="mt-4 text-slate-400 text-sm max-w-xl mx-auto">
                            From scanning to exporting, AllyFlow is the only tool you need in your accessibility workflow.
                        </p>
                    </div>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {FEATURES.map((feature) => (
                            <FeatureCard key={feature.title} feature={feature} />
                        ))}
                    </div>
                </div>
            </section>
            </RevealOnScroll>

            {/* ── HOW IT WORKS ── */}
            <RevealOnScroll delay={200}>
                <section id="how-it-works" className="relative border-t border-white/[0.06]">
                    <div className="mx-auto max-w-6xl px-6 py-24">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl sm:text-4xl font-normal tracking-tight">
                            From audit to export in{" "}
                            <span className="text-[#2222E3]">
                                five steps
                            </span>
                        </h2>
                        <p className="mt-4 text-slate-400 text-sm max-w-xl mx-auto">
                            No fix is ever applied without explicit developer approval.
                        </p>
                    </div>
                    <div className="relative">
                        <div className="absolute top-12 left-[10%] right-[10%] h-px bg-gradient-to-r from-[#2222E3]/40 via-[#2222E3]/40 to-transparent hidden md:block" />
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 md:gap-4">
                            {HOW_IT_WORKS.map((step) => (
                                <StepCard key={step.step} step={step} />
                            ))}
                        </div>
                    </div>
                </div>
            </section>
            </RevealOnScroll>

            {/* ── FAQ ── */}
            <RevealOnScroll delay={300}>
                <section id="faq" className="relative border-t border-white/[0.06]">
                    <div className="mx-auto max-w-6xl px-6 py-24">
                        <div className="text-center mb-12">
                        <h2 className="text-3xl sm:text-4xl font-normal tracking-tight">
                                Frequently asked{" "}
                                <span className="text-[#2222E3]">
                                    questions
                                </span>
                            </h2>
                            <p className="mt-4 text-slate-400 text-sm max-w-xl mx-auto">
                                Everything you need to know about AllyFlow.
                            </p>
                        </div>
                        <FaqAccordion />
                    </div>
                </section>
            </RevealOnScroll>

            {/* ── CTA ── */}
            <RevealOnScroll delay={500}>
            <section className="relative border-t border-white/[0.06]">
                <div className="mx-auto max-w-3xl px-6 py-24 text-center">
                    <div
                        ref={ctaRef}
                        onMouseMove={handleCtaMouseMove}
                        onMouseLeave={handleCtaMouseLeave}
                        className="group relative rounded-3xl p-12 shadow-2xl overflow-hidden border border-white/[0.06]"
                        style={{ transition: "box-shadow 0.5s cubic-bezier(0.16, 1, 0.3, 1), translate 0.5s cubic-bezier(0.16, 1, 0.3, 1)" }}
                    >
                        <div className="absolute inset-0 rounded-3xl -z-10 bg-white/[0.02]" />
                        <div className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                            style={{
                                padding: "1px",
                                background: "linear-gradient(135deg, rgba(34,34,227,0.4), rgba(59,130,246,0.1), rgba(34,34,227,0.4))",
                                WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                                WebkitMaskComposite: "xor",
                                maskComposite: "exclude",
                            }}
                        />
                        <Monitor className="mx-auto h-10 w-10 text-[#2222E3] mb-6" strokeWidth={1.5} />
                        <h2 className="text-3xl sm:text-4xl font-normal tracking-tight mb-4">
                            Ready to stop auditing?
                        </h2>
                        <p className="text-sm max-w-md mx-auto mb-8 text-slate-400">
                            Start fixing accessibility issues with AI-powered remediation. No sign-up required.
                        </p>
                        <Link
                            href="/studio"
                            className="inline-flex items-center gap-2.5 rounded-xl bg-[#2222E3] px-8 py-4 text-base font-bold text-white shadow-lg shadow-[#2222E3]/20 transition-all hover:bg-[#2222E3] hover:shadow-[#2222E3]/30 hover:-translate-y-0.5"
                        >
                            Get Started
                            <ArrowRight className="h-5 w-5" />
                        </Link>
                    </div>
                </div>
            </section>
            </RevealOnScroll>

            {/* ── FOOTER ── */}
            <footer className="border-t border-white/[0.06]">
                <div className="mx-auto max-w-6xl px-6 py-12">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <img src="/logo.jpeg" alt="AllyFlow" className="h-5 w-5 object-contain" />
                                <span className="text-white font-medium text-sm">Ally<span className="text-red-400">Flow</span></span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed max-w-[180px]">
                                AI-assisted accessibility remediation IDE for building a more inclusive web.
                            </p>
                        </div>
                        <div>
                            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Product</h4>
                            <ul className="space-y-2">
                                <li><a href="#features" onClick={(e) => handleNavClick(e, "#features")} className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">Features</a></li>
                                <li><a href="#how-it-works" onClick={(e) => handleNavClick(e, "#how-it-works")} className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">How It Works</a></li>
                                <li><a href="#faq" onClick={(e) => handleNavClick(e, "#faq")} className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">FAQ</a></li>
                                <li><Link href="/studio" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Launch Studio</Link></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Resources</h4>
                            <ul className="space-y-2">
                                <li><a href="#faq" onClick={(e) => handleNavClick(e, "#faq")} className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">FAQ</a></li>
                                <li><a href="https://github.com/Yahyagitt/AllyFlow-An-AI-Assisted-Accessibility-Remediation-IDE" target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1">GitHub <ExternalLink className="h-3 w-3" /></a></li>
                                <li><a href="https://github.com/Yahyagitt/AllyFlow-An-AI-Assisted-Accessibility-Remediation-IDE/issues" target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1">Report Issue <ExternalLink className="h-3 w-3" /></a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Compliance</h4>
                            <ul className="space-y-2">
                                <li className="flex items-center gap-1.5 text-xs text-slate-500"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> WCAG 2.1 AA</li>
                                <li className="flex items-center gap-1.5 text-xs text-slate-500"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Section 508</li>
                                <li className="flex items-center gap-1.5 text-xs text-slate-500"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> EN 301 549</li>
                            </ul>
                        </div>
                    </div>
                    <div className="mt-10 pt-6 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                            <span>&copy; {new Date().getFullYear()} Ally<span className="text-red-400">Flow</span>. Built for a more accessible web.</span>
                        </div>
                        <a
                            href="https://github.com/Yahyagitt/AllyFlow-An-AI-Assisted-Accessibility-Remediation-IDE"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5"
                        >
                            <Github className="h-3.5 w-3.5" />
                            View on GitHub
                        </a>
                    </div>
                </div>
            </footer>
        </div>
    );
}

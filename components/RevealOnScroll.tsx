"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function RevealOnScroll({
    children,
    className = "",
    delay = 0,
}: {
    children: ReactNode;
    className?: string;
    delay?: number;
}) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    el.style.transitionDelay = `${delay}ms`;
                    el.classList.add("animate-fade-in-up-smooth");
                    el.style.opacity = "1";
                    observer.unobserve(el);
                }
            },
            { threshold: 0.05, rootMargin: "0px 0px -60px 0px" }
        );

        requestAnimationFrame(() => observer.observe(el));
        return () => observer.disconnect();
    }, [delay]);

    return (
        <div ref={ref} className={className} style={{ opacity: 0 }}>
            {children}
        </div>
    );
}

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
    display: "swap",
});

export const metadata: Metadata = {
    title: "AllyFlow — AI-Powered Accessibility Remediation IDE",
    description:
        "Stop auditing. Start fixing. AllyFlow is an AI-assisted IDE that scans web pages for WCAG 2.1 AA violations and drafts fixes using Gemini AI. Powered by axe-core, Monaco editor, and a deterministic offline fallback engine.",
    keywords: ["accessibility", "a11y", "WCAG", "audit", "AI", "axe-core", "remediation", "allyflow"],
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className="dark">
            <body className={`${inter.variable} font-sans antialiased bg-mesh min-h-screen`}>
                {children}
                <Toaster position="bottom-right" theme="dark" richColors />
            </body>
        </html>
    );
}

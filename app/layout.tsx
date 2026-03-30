import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
    display: "swap",
});

export const metadata: Metadata = {
    title: "AllyFlow — AI Accessibility Auditor",
    description:
        "Scan any web page for accessibility violations and get AI-powered fixes. Powered by axe-core and Gemini AI.",
    keywords: ["accessibility", "a11y", "WCAG", "audit", "AI", "axe-core"],
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
            </body>
        </html>
    );
}

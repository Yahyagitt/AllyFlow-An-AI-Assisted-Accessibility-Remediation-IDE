import type { Metadata } from "next";
import { Inter, Geist } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

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
        <html lang="en" className={cn("dark", "font-sans", geist.variable)}>
            <body className={`${inter.variable} font-sans antialiased bg-mesh min-h-screen`}>
                {children}
                <Toaster position="bottom-right" theme="dark" richColors />
            </body>
        </html>
    );
}
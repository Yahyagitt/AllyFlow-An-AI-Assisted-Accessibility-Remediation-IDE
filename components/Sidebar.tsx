"use client";

import { cn } from "@/lib/utils";
import {
    Activity,
    Shield,
    Settings,
    Zap,
    ChevronRight,
} from "lucide-react";
import { useState } from "react";
import Link from "next/link";

interface NavItem {
    id: string;
    icon: React.ElementType;
    label: string;
    badge?: number;
}

const NAV_ITEMS: NavItem[] = [
    { id: "dashboard", icon: Activity, label: "Dashboard" },
    { id: "audit", icon: Shield, label: "Audit Studio" },
    { id: "settings", icon: Settings, label: "Settings" },
];

interface SidebarProps {
    activeTab: string;
    onTabChange: (id: string) => void;
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <aside
            className={cn(
                "flex flex-col h-screen sticky top-0 transition-all duration-300 ease-in-out z-20",
                "bg-[#111113] border-r border-white/[0.06]",
                collapsed ? "w-[68px]" : "w-[220px]"
            )}
        >
            {/* Logo — links to landing page */}
            <Link
                href="/"
                className="flex items-center gap-3 px-4 py-5 border-b border-white/[0.06] hover:opacity-80 transition-opacity"
            >
                <div className="relative flex-shrink-0 w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
                {!collapsed && (
                    <span className="text-white font-normal text-2xl tracking-tight select-none">
                        AllyFlow
                    </span>
                )}
            </Link>

            {/* Nav */}
            <nav className="flex flex-col gap-2 p-3 flex-1" aria-label="Main navigation">
                {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                        <button
                            key={item.id}
                            id={`nav-${item.id}`}
                            onClick={() => onTabChange(item.id)}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                                "group flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium",
                                "transition-all duration-200 w-full text-left",
                                isActive
                                    ? "text-white bg-white/[0.06]"
                                    : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]"
                            )}
                        >
                            <Icon
                                className={cn(
                                    "flex-shrink-0 transition-colors",
                                    collapsed ? "w-5 h-5 mx-auto" : "w-4 h-4",
                                    isActive ? "text-white" : "text-slate-500 group-hover:text-slate-300"
                                )}
                                strokeWidth={isActive ? 2.5 : 2}
                                aria-hidden="true"
                            />
                            {!collapsed && (
                                <>
                                    <span className="flex-1">{item.label}</span>
                                    {item.badge !== undefined && (
                                        <span className="flex-shrink-0 text-xs bg-white/10 text-white rounded-full px-2 py-0.5 border border-white/10">
                                            {item.badge}
                                        </span>
                                    )}
                                </>
                            )}
                        </button>
                    );
                })}
            </nav>

            {/* Collapse toggle */}
            <div className="p-3 border-t border-white/[0.06]">
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    id="sidebar-collapse-btn"
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    className="text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] border border-transparent rounded-lg p-2 w-full flex items-center justify-center transition-all duration-200"
                >
                    <ChevronRight
                        className={cn(
                            "w-4 h-4 transition-transform duration-300",
                            collapsed ? "rotate-0" : "rotate-180"
                        )}
                    />
                </button>
            </div>
        </aside>
    );
}

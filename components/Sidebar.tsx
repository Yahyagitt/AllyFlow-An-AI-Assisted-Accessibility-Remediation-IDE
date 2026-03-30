"use client";

import { cn } from "@/lib/utils";
import {
    Activity,
    Shield,
    Code2,
    Settings,
    Zap,
    ChevronRight,
} from "lucide-react";
import { useState } from "react";

interface NavItem {
    id: string;
    icon: React.ElementType;
    label: string;
    badge?: number;
}

const NAV_ITEMS: NavItem[] = [
    { id: "dashboard", icon: Activity, label: "Dashboard" },
    { id: "audit", icon: Shield, label: "Audit", badge: 3 },
    { id: "diff", icon: Code2, label: "Diff View" },
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
                "glass border-r border-white/[0.06]",
                collapsed ? "w-[68px]" : "w-[220px]"
            )}
        >
            {/* Logo */}
            <div className="flex items-center gap-3 px-4 py-5 border-b border-white/[0.06]">
                <div className="relative flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center glow-blue">
                    <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
                </div>
                {!collapsed && (
                    <span className="text-gradient font-bold text-base tracking-tight select-none">
                        AllyFlow
                    </span>
                )}
            </div>

            {/* Nav */}
            <nav className="flex flex-col gap-1 p-3 flex-1" aria-label="Main navigation">
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
                                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                                "transition-all duration-200 w-full text-left",
                                isActive
                                    ? "bg-blue-500/15 text-blue-400 border border-blue-500/20"
                                    : "text-muted-foreground hover:text-foreground glass-hover border border-transparent"
                            )}
                        >
                            <Icon
                                className={cn(
                                    "flex-shrink-0 transition-colors",
                                    collapsed ? "w-5 h-5 mx-auto" : "w-4 h-4",
                                    isActive ? "text-blue-400" : "text-muted-foreground group-hover:text-foreground"
                                )}
                                strokeWidth={isActive ? 2.5 : 2}
                                aria-hidden="true"
                            />
                            {!collapsed && (
                                <>
                                    <span className="flex-1">{item.label}</span>
                                    {item.badge !== undefined && (
                                        <span className="flex-shrink-0 text-xs bg-blue-500/20 text-blue-400 rounded-full px-2 py-0.5 border border-blue-500/20">
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
                    className="glass-hover border border-transparent rounded-lg p-2 w-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-all duration-200"
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

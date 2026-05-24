"use client";

import React from "react";
import Link from "next/link";
import { LayoutGrid, List, Filter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TerminalLayoutProps {
    children: React.ReactNode;
    activeCategory: string;
    categories: string[];
    onCategoryChange: (category: string) => void;
    stats: string;
}

export const TerminalLayout = ({
    children,
    activeCategory,
    categories,
    onCategoryChange,
    stats
}: TerminalLayoutProps) => {
    return (
        <div className="main-wrapper bg-bg-base selection:bg-accent-primary/30">
            {/* Top Navigation Bar */}
            <nav className="h-16 border-b border-white/[0.04] bg-bg-surface/80 backdrop-blur-xl sticky top-0 z-50 flex items-center justify-between px-6">
                <div className="flex items-center gap-8">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-accent-primary flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.4)]">
                            <span className="font-outfit font-black text-white text-lg">S</span>
                        </div>
                        <span className="font-outfit font-bold text-lg tracking-tight">Rawali Analytic</span>
                    </div>

                    <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-white/[0.03] border border-white/[0.05] rounded-full">
                        <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                        <span className="text-[10px] font-bold text-ink-muted uppercase tracking-widest">{stats}</span>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden lg:flex items-center gap-6 mr-6">
                        <Link href="/" className="text-xs font-bold text-ink-muted hover:text-white transition-colors uppercase tracking-widest">Events</Link>
                        <Link href="/portfolio" className="text-xs font-bold text-ink-muted hover:text-white transition-colors uppercase tracking-widest">Portfolio</Link>
                    </div>
                    <Button variant="secondary" size="sm" className="hidden sm:flex" asChild>
                        <Link href="/portfolio">Portfolio</Link>
                    </Button>
                </div>
            </nav>

            {/* Main Terminal View */}
            <main className="flex-1 flex flex-col">
                {/* Terminal Header / Controls */}
                <div className="p-6 border-b border-white/[0.04] flex flex-wrap items-center justify-between gap-6 bg-bg-base">
                    <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
                        {categories.map((cat) => (
                            <button
                                key={cat}
                                onClick={() => onCategoryChange(cat)}
                                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${activeCategory === cat
                                        ? "bg-accent-primary text-white shadow-[0_4px_12px_rgba(99,102,241,0.2)]"
                                        : "text-ink-muted hover:text-white hover:bg-white/[0.03]"
                                    }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-3 ml-auto">
                        <div className="relative w-64 hidden md:block">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                            <input
                                placeholder="Search events..."
                                className="w-full bg-bg-elevated border border-white/5 rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-accent-primary/30 transition-all font-medium"
                            />
                        </div>
                        <div className="flex items-center bg-bg-elevated border border-white/5 rounded-lg p-1">
                            <button className="p-1.5 bg-white/5 rounded text-accent-primary shadow-sm"><LayoutGrid size={14} /></button>
                            <button className="p-1.5 text-ink-muted hover:text-white"><List size={14} /></button>
                        </div>
                    </div>
                </div>

                {/* Dynamic Content */}
                <div className="flex-1 p-6">
                    {children}
                </div>
            </main>

            {/* Global Footer */}
            <footer className="h-12 border-t border-white/[0.04] bg-bg-surface flex items-center justify-between px-6">
                <div className="flex items-center gap-4 text-[10px] font-bold text-ink-muted uppercase tracking-[0.2em]">
                    <span>© 2024 Rawali Analytic</span>
                    <span className="text-white/10">•</span>
                    <span>Open Liquidity Infrastructure</span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-success uppercase tracking-widest">
                        <span className="w-1.5 h-1.5 rounded-full bg-success" />
                        Infrastructure Operational
                    </div>
                </div>
            </footer>
        </div>
    );
};

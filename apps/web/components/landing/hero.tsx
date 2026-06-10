"use client";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

export function Hero() {
  return (
    <section className="relative min-h-[80vh] flex flex-col items-center justify-center text-center px-4 py-20 md:py-32">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgb(var(--canton-rgb)/0.08),transparent)]" />
      <div className="relative z-10 max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl md:text-6xl">
          Complete Quests.<br />Earn <span className="text-[var(--primary)]">CC Tokens</span>.
        </h1>
        <p className="mt-4 text-base text-[var(--muted-foreground)] sm:text-lg max-w-xl mx-auto">
          Join CanQuest — the Web3 quest platform. Complete tasks, earn rewards, and climb the leaderboard.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <Link href="/?auth=register" className={cn(buttonVariants(), "rounded-lg px-6 py-2.5")}>Get Started</Link>
          <Link href="/?auth=login" className={cn(buttonVariants({ variant: "secondary" }), "rounded-lg px-6 py-2.5")}>Sign In</Link>
        </div>
      </div>
    </section>
  );
}
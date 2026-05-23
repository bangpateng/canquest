"use client";

import { motion } from "framer-motion";
import { ArrowRight, Gift, Sparkles, Ticket, Wallet } from "lucide-react";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const highlights = [
  { icon: Gift, title: "Quest campaigns", short: "Quests", value: "Earn CC & rewards" },
  { icon: Wallet, title: "Canton wallet", short: "Wallet", value: "Party-bound identity" },
  { icon: Ticket, title: "Daily spin", short: "Spin", value: "Bonus prizes" },
];

const stats = [
  { value: "48K+", label: "Quests completed" },
  { value: "2.1M", label: "CC distributed" },
  { value: "120K+", label: "Tasks verified" },
];

export function LandingHero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-[var(--border)]">
      <div className="gradient-mesh particle-field absolute inset-0 opacity-80" />
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-72 w-[min(100%,36rem)] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgb(var(--canton-rgb) / 0.25) 0%, transparent 70%)",
        }}
      />

      <LandingShell className="relative flex flex-col gap-8 py-8 md:py-10 lg:flex-row lg:items-center lg:gap-10">
        <div className="flex-1 space-y-5">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full border border-canton-muted bg-canton-subtle/80 px-4 py-1.5 text-xs font-semibold text-canton backdrop-blur-sm"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Web3 Quest Platform · Canton Network
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="type-hero max-w-2xl"
          >
            Complete quests.{" "}
            <span className="text-gradient-brand">Earn on-chain.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="max-w-xl text-base leading-relaxed text-[var(--muted-foreground)]"
          >
            Galxe-style missions with verified tasks, leaderboard rankings, and Canton-native
            rewards — built for teams who need audit trails, not hype.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex flex-col gap-4 sm:flex-row sm:items-center"
          >
            <LaunchAppButton
              size="lg"
              showArrow
              className="rounded-full px-7 py-3.5 text-base font-bold shadow-[0_0_40px_rgb(var(--canton-rgb)/0.3)]"
            />
            <a href="#campaigns" className="inline-flex justify-center sm:justify-start">
              <span
                className={cn(
                  buttonVariants({ variant: "secondary", size: "lg" }),
                  "inline-flex gap-2 rounded-full border-[var(--border)] bg-[var(--card)]/60 backdrop-blur-sm",
                )}
              >
                Explore quests
                <ArrowRight className="h-4 w-4" />
              </span>
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-3 gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)]/40 p-2 lg:hidden"
          >
            {highlights.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex flex-col items-center gap-1 py-2 text-center">
                  <Icon className="h-4 w-4 text-canton" />
                  <p className="text-[10px] font-semibold leading-tight">{item.short}</p>
                </div>
              );
            })}
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.28 }}
            className="flex flex-wrap gap-6 pt-1 sm:gap-8"
          >
            {stats.map((s) => (
              <div key={s.label}>
                <p className="type-stat">
                  {s.value}
                </p>
                <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {s.label}
                </p>
              </div>
            ))}
          </motion.div>
        </div>

        <div className="relative hidden flex-1 flex-col gap-3 lg:flex lg:max-w-sm">
          {highlights.map((item, i) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className="group glass-card glass-card-hover flex items-center gap-3 rounded-xl p-4 ring-1 ring-[var(--border)]"
                whileHover={{ x: 4 }}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-canton-subtle ring-1 ring-[var(--primary)]/20 transition-all group-hover:shadow-[0_0_20px_rgb(var(--canton-rgb)/0.15)]">
                  <Icon className="h-4 w-4 text-canton" />
                </span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {item.title}
                  </p>
                  <p className="type-subsection-title">
                    {item.value}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </LandingShell>
    </section>
  );
}

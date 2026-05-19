"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const floatCards = [
  { title: "Institutional quests", points: "+2.4k pts", delay: 0 },
  { title: "Canton identity", points: "Party bound", delay: 0.15 },
  { title: "Spin pool", points: "Live rewards", delay: 0.3 },
];

export function LandingHero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-[var(--border)]">
      <div className="gradient-mesh particle-field absolute inset-0 opacity-60" />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-12 px-4 py-20 sm:px-6 lg:flex-row lg:items-center lg:py-28">
        <div className="flex-1 space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--muted-foreground)]"
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--primary-strong)]" />
            Built for Canton Network
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.05 }}
            className="font-[family-name:var(--font-space)] text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl"
          >
            Quest • Earn •{" "}
            <span className="text-[var(--muted-foreground)]">Build on Canton</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="max-w-xl text-lg text-[var(--muted-foreground)]"
          >
            A premium enterprise quest layer: verified tasks, auditable rewards,
            and Canton-native identity—without the noisy crypto dashboard clichés.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.15 }}
            className="flex flex-wrap gap-3"
          >
            <Link
              href="/dashboard"
              className={cn(buttonVariants({ size: "lg" }), "gap-2")}
            >
              Open dapp
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#campaigns">
              <span
                className={cn(
                  buttonVariants({ variant: "secondary", size: "lg" }),
                  "inline-flex",
                )}
              >
                View campaigns
              </span>
            </a>
          </motion.div>
        </div>
        <div className="relative flex flex-1 flex-col gap-4 lg:pl-8">
          {floatCards.map((c) => (
            <motion.div
              key={c.title}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 + c.delay }}
              className="glass-card rounded-2xl p-5"
              whileHover={{ y: -4 }}
            >
              <p className="text-sm font-medium text-[var(--muted-foreground)]">
                {c.title}
              </p>
              <p className="mt-1 font-[family-name:var(--font-space)] text-xl font-semibold">
                {c.points}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

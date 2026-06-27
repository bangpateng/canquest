"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { TurnstileField } from "@/components/platform/turnstile-field";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

type Status = "idle" | "submitting" | "success" | "error";

const COLLABORATION_TYPES = [
  { value: "earn_campaign", label: "Earn campaign" },
  { value: "event_launch", label: "Event / launch" },
  { value: "ecosystem", label: "Ecosystem / tooling" },
  { value: "other", label: "Something else" },
] as const;

const BUDGETS = [
  "Under $1k",
  "$1k – $5k",
  "$5k – $25k",
  "$25k+",
  "Not sure yet",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting") return;

    setError(null);

    const form = e.currentTarget;
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const organization = String(fd.get("organization") ?? "").trim();
    const collaborationType = String(fd.get("collaborationType") ?? "").trim();
    const budget = String(fd.get("budget") ?? "").trim();
    const message = String(fd.get("message") ?? "").trim();

    if (!name) return setError("Please enter your name.");
    if (!EMAIL_RE.test(email)) return setError("Please enter a valid email address.");
    if (message.length < 10) return setError("Tell us a bit more (at least 10 characters).");

    setStatus("submitting");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          organization: organization || undefined,
          collaborationType: collaborationType || undefined,
          budget: budget || undefined,
          message,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };

      if (!res.ok) {
        setStatus("error");
        setError(data.message ?? "Something went wrong. Please try again.");
        setResetKey((k) => k + 1); // force Turnstile re-challenge
        return;
      }

      setStatus("success");
      form.reset();
      setResetKey((k) => k + 1);
    } catch {
      setStatus("error");
      setError("Network error. Please check your connection and try again.");
      setResetKey((k) => k + 1);
    }
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-canton-strong/30 bg-canton-subtle/40 px-6 py-10 text-center">
        <CheckCircle2 className="h-10 w-10 text-canton" aria-hidden />
        <p className="text-base font-semibold text-[var(--foreground)]">
          Thanks — your message is on its way.
        </p>
        <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
          Our team received your submission and will reply to your email, usually within a
          few business days.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-2 text-sm text-canton underline-offset-2 hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-canton-muted focus:outline-none focus:ring-1 focus:ring-canton-muted";
  const labelClass =
    "block text-xs font-medium text-[var(--muted-foreground)]";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="cf-name" className={labelClass}>
            Name <span className="text-canton">*</span>
          </label>
          <input
            id="cf-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            maxLength={100}
            className={cn(inputClass, "mt-1")}
            placeholder="Jane Doe"
          />
        </div>
        <div>
          <label htmlFor="cf-email" className={labelClass}>
            Email <span className="text-canton">*</span>
          </label>
          <input
            id="cf-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={160}
            className={cn(inputClass, "mt-1")}
            placeholder="you@project.com"
          />
        </div>
      </div>

      <div>
        <label htmlFor="cf-org" className={labelClass}>
          Organization / Project
        </label>
        <input
          id="cf-org"
          name="organization"
          type="text"
          maxLength={160}
          className={cn(inputClass, "mt-1")}
          placeholder="Acme Canton"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="cf-type" className={labelClass}>
            Collaboration type
          </label>
          <select id="cf-type" name="collaborationType" className={cn(inputClass, "mt-1")}>
            <option value="">Select…</option>
            {COLLABORATION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cf-budget" className={labelClass}>
            Estimated budget
          </label>
          <select id="cf-budget" name="budget" className={cn(inputClass, "mt-1")}>
            <option value="">Select…</option>
            {BUDGETS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="cf-message" className={labelClass}>
          Tell us about your project <span className="text-canton">*</span>
        </label>
        <textarea
          id="cf-message"
          name="message"
          required
          minLength={10}
          maxLength={4000}
          rows={5}
          className={cn(inputClass, "mt-1 resize-y")}
          placeholder="What are you building, your timeline, target audience, and reward goals?"
        />
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">
          Human check <span className="text-canton">*</span>
        </p>
        <TurnstileField onToken={setTurnstileToken} resetKey={resetKey} />
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "submitting"}
        className={cn(
          buttonVariants({ size: "lg" }),
          "w-full justify-center rounded-full sm:w-auto",
          status === "submitting" && "opacity-70",
        )}
      >
        {status === "submitting" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Sending…
          </>
        ) : (
          <>
            <Send className="h-4 w-4" aria-hidden />
            Send to our team
          </>
        )}
      </button>

      <p className="text-xs text-[var(--muted-foreground)]">
        Your submission goes straight to{" "}
        <span className="font-medium text-[var(--foreground)]">team@canquest.cc</span>. We
        only use your details to reply about your proposal.
      </p>
    </form>
  );
}

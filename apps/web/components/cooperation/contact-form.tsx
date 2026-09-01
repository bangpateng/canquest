"use client";

import { useState } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { CheckCircle2, Send } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

/**
 * Partnership / cooperation contact form.
 *
 * Submissions are POSTed directly to Web3Forms (https://web3forms.com), which
 * forwards them to team@canquest.cc. This is frontend-only: no CanQuest API
 * or VPS involvement, no email client required from the visitor, and the
 * visitor's message lands in our inbox as a normal email.
 *
 * The access key is safe to expose publicly (it only authorizes sending TO the
 * inbox registered to the key). Set it via NEXT_PUBLIC_WEB3FORMS_KEY on Vercel;
 * until then it falls back to the inline constant below.
 *
 * Get a free key (250 submissions/mo): https://web3forms.com → sign in with
 * team@canquest.cc → copy the "Access Key".
 */

// Web3Forms access key — public-safe (only authorizes sending TO the inbox
// registered to the key, i.e. team@canquest.cc). Override via
// NEXT_PUBLIC_WEB3FORMS_KEY on Vercel if you ever need to rotate it.
const WEB3FORMS_ACCESS_KEY =
  process.env.NEXT_PUBLIC_WEB3FORMS_KEY?.trim() ||
  "3f131914-8aae-4a73-b1db-b29cf24aca57";

const SUBMIT_URL = "https://api.web3forms.com/submit";
const CONTACT_EMAIL = "team@canquest.cc";

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

const TIMELINES = [
  "ASAP",
  "1–2 weeks",
  "Within a month",
  "Just exploring",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

type Status = "idle" | "submitting" | "success" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const organization = String(fd.get("organization") ?? "").trim();
    const website = String(fd.get("website") ?? "").trim();
    const handle = String(fd.get("handle") ?? "").trim();
    const collaborationType = String(fd.get("collaborationType") ?? "").trim();
    const budget = String(fd.get("budget") ?? "").trim();
    const timeline = String(fd.get("timeline") ?? "").trim();
    const message = String(fd.get("message") ?? "").trim();
    // Web3Forms honeypot: real users never fill this hidden field.
    const botcheck = String(fd.get("botcheck") ?? "").trim();

    if (!name) {
      setError("Please enter your name.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (website && !URL_RE.test(website)) {
      setError("Website URL must start with http:// or https://");
      return;
    }
    if (message.length < 10) {
      setError("Tell us a bit more (at least 10 characters).");
      return;
    }

    const typeLabel =
      COLLABORATION_TYPES.find((t) => t.value === collaborationType)?.label ??
      collaborationType;

    const payload = new FormData();
    payload.append("access_key", WEB3FORMS_ACCESS_KEY);
    payload.append("subject", `Partnership inquiry — ${name}`);
    payload.append("from_name", "CanQuest Cooperation");
    payload.append("to", CONTACT_EMAIL);
    payload.append("replyto", email);
    // Web3Forms sends a confirmation email to this address if set.
    payload.append("email", email);
    payload.append("Name", name);
    payload.append("Email", email);
    if (organization) payload.append("Organization / Project", organization);
    if (website) payload.append("Website", website);
    if (handle) payload.append("Telegram / Discord", handle);
    if (typeLabel) payload.append("Collaboration type", typeLabel);
    if (budget) payload.append("Estimated budget", budget);
    if (timeline) payload.append("Timeline", timeline);
    payload.append("Message", message);
    payload.append("botcheck", botcheck);

    setStatus("submitting");
    try {
      const res = await fetch(SUBMIT_URL, {
        method: "POST",
        body: payload,
      });
      const data = (await res.json()) as { success: boolean; message?: string };
      if (data.success) {
        setStatus("success");
        form.reset();
      } else {
        setStatus("error");
        setError(
          data.message ?? "Something went wrong. Please try again or email us directly.",
        );
      }
    } catch {
      setStatus("error");
      setError("Network error. Please check your connection and try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-canton-strong/30 bg-canton-subtle/40 px-6 py-10 text-center">
        <CheckCircle2 className="h-10 w-10 text-canton" aria-hidden />
        <p className="text-base font-semibold text-[var(--foreground)]">
          Message sent — thank you!
        </p>
        <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
          Your message is on its way to our team at{" "}
          <span className="font-medium text-[var(--foreground)]">
            {CONTACT_EMAIL}
          </span>
          . We typically reply within a few business days.
        </p>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setError(null);
          }}
          className="mt-2 text-sm text-canton underline-offset-2 hover:underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-canton-muted focus:outline-none focus:ring-1 focus:ring-canton-muted";
  const labelClass = "block text-xs font-medium text-[var(--muted-foreground)]";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Honeypot — hidden from humans, catches bots. */}
      <input
        type="checkbox"
        name="botcheck"
        className="hidden"
        style={{ display: "none" }}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
      />

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

      <div className="grid gap-4 sm:grid-cols-2">
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
        <div>
          <label htmlFor="cf-website" className={labelClass}>
            Website / Project URL <span className="text-canton">*</span>
          </label>
          <input
            id="cf-website"
            name="website"
            type="url"
            required
            maxLength={300}
            className={cn(inputClass, "mt-1")}
            placeholder="https://yourproject.cc"
          />
        </div>
      </div>

      <div>
        <label htmlFor="cf-handle" className={labelClass}>
          Telegram / Discord
        </label>
        <input
          id="cf-handle"
          name="handle"
          type="text"
          maxLength={120}
          className={cn(inputClass, "mt-1")}
          placeholder="@yourhandle or discord username"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="cf-type" className={labelClass}>
            Collaboration type
          </label>
          <select
            id="cf-type"
            name="collaborationType"
            className={cn(inputClass, "mt-1")}
          >
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
        <div>
          <label htmlFor="cf-timeline" className={labelClass}>
            Timeline
          </label>
          <select
            id="cf-timeline"
            name="timeline"
            className={cn(inputClass, "mt-1")}
          >
            <option value="">Select…</option>
            {TIMELINES.map((t) => (
              <option key={t} value={t}>
                {t}
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
          placeholder="What are you building, your goal, target audience, and reward ideas?"
        />
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "submitting"}
        className={cn(
          buttonVariants({ size: "lg" }),
          "w-full justify-center rounded-full sm:w-auto",
          status === "submitting" && "cursor-not-allowed opacity-70",
        )}
      >
        {status === "submitting" ? (
          <LoadingSpinner size="md" />
        ) : (
          <Send className="h-4 w-4" aria-hidden />
        )}
        {status === "submitting" ? "Sending…" : "Send to our team"}
      </button>

      <p className="text-xs text-[var(--muted-foreground)]">
        Your message goes straight to{" "}
        <span className="font-medium text-[var(--foreground)]">
          {CONTACT_EMAIL}
        </span>
        . We never store your details beyond the email itself.
      </p>
    </form>
  );
}

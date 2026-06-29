"use client";

import { useState } from "react";
import { CheckCircle2, Mail, Send } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";

type Status = "idle" | "success";

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

/** Inbox that receives partnership submissions. */
const CONTACT_EMAIL = "team@canquest.cc";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mailtoHref, setMailtoHref] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const organization = String(fd.get("organization") ?? "").trim();
    const collaborationType = String(fd.get("collaborationType") ?? "").trim();
    const budget = String(fd.get("budget") ?? "").trim();
    const message = String(fd.get("message") ?? "").trim();

    if (!name) {
      setError("Please enter your name.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (message.length < 10) {
      setError("Tell us a bit more (at least 10 characters).");
      return;
    }

    // No server / no API: the visitor sends the email from their own client.
    const typeLabel =
      COLLABORATION_TYPES.find((t) => t.value === collaborationType)?.label ??
      collaborationType;

    const lines = [
      `Name: ${name}`,
      `Email: ${email}`,
      organization ? `Organization / Project: ${organization}` : null,
      typeLabel ? `Collaboration type: ${typeLabel}` : null,
      budget ? `Estimated budget: ${budget}` : null,
      "",
      "Message:",
      message,
      "",
      "— Sent via canquest.cc/cooperation",
    ].filter((v) => v !== null) as string[];

    const subject = `Partnership inquiry — ${name}`;
    const body = lines.join("\r\n");
    const href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;

    setMailtoHref(href);
    // Opens the visitor's default mail client with everything pre-filled.
    window.location.href = href;
    setStatus("success");
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-canton-strong/30 bg-canton-subtle/40 px-6 py-10 text-center">
        <CheckCircle2 className="h-10 w-10 text-canton" aria-hidden />
        <p className="text-base font-semibold text-[var(--foreground)]">
          Your email app should have opened.
        </p>
        <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
          We&apos;ve drafted a message addressed to{" "}
          <span className="font-medium text-[var(--foreground)]">
            {CONTACT_EMAIL}
          </span>{" "}
          with your details. Just hit <strong>send</strong> in your mail app and
          our team will reply within a few business days.
        </p>

        {mailtoHref ? (
          <a
            href={mailtoHref}
            className={cn(
              buttonVariants({ size: "sm" }),
              "mt-1 rounded-full",
            )}
          >
            <Mail className="h-4 w-4" aria-hidden />
            Reopen my email app
          </a>
        ) : null}

        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          No mail app? Send it manually to{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-canton underline-offset-2 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>

        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setMailtoHref(null);
          }}
          className="mt-2 text-sm text-canton underline-offset-2 hover:underline"
        >
          Start a new message
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

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className={cn(
          buttonVariants({ size: "lg" }),
          "w-full justify-center rounded-full sm:w-auto",
        )}
      >
        <Send className="h-4 w-4" aria-hidden />
        Send to our team
      </button>

      <p className="text-xs text-[var(--muted-foreground)]">
        Clicking send opens your email app with a message addressed to{" "}
        <span className="font-medium text-[var(--foreground)]">
          {CONTACT_EMAIL}
        </span>
        . You send it yourself — we never store your details on a server.
      </p>
    </form>
  );
}

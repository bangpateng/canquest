import { cn } from "@/lib/utils/utils";

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn(
        align === "center" ? "mx-auto max-w-xl text-center" : "max-w-xl",
        className,
      )}
    >
      {eyebrow ? <p className="type-eyebrow-brand">{eyebrow}</p> : null}
      <h2
        className={cn(
          "font-bold tracking-tight text-[var(--foreground)]",
          eyebrow ? "mt-2" : "",
          "text-xl sm:text-2xl",
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}

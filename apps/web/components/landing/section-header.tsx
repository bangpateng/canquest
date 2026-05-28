import { cn } from "@/lib/utils";

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
        align === "center"
          ? "mx-auto mb-10 max-w-2xl text-center md:mb-12"
          : "mb-10 max-w-2xl md:mb-12",
        className,
      )}
    >
      {eyebrow ? <p className="type-eyebrow-brand">{eyebrow}</p> : null}
      <h2
        className={cn(
          "type-display font-bold tracking-tight text-[var(--foreground)]",
          eyebrow ? "mt-2" : "",
          "text-2xl leading-tight sm:text-3xl lg:text-4xl",
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base sm:leading-relaxed">
          {description}
        </p>
      ) : null}
    </div>
  );
}

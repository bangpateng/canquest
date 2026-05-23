export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "left",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div
      className={
        align === "center"
          ? "mx-auto mb-8 max-w-2xl text-center"
          : "mb-8 max-w-2xl"
      }
    >
      {eyebrow ? (
        <p className="text-xs font-bold uppercase tracking-widest text-canton">{eyebrow}</p>
      ) : null}
      <h2 className={`type-hero ${eyebrow ? "mt-2" : ""}`}>
        {title}
      </h2>
      {description ? (
        <p className="mt-3 text-base leading-relaxed text-[var(--muted-foreground)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}

import { cn } from "@/lib/utils";
import type { ElementType, ReactNode } from "react";

type TypographyProps = {
  children: ReactNode;
  className?: string;
  as?: ElementType;
};

export function ToolbarTitle({ children, className, as: Tag = "h1" }: TypographyProps) {
  return <Tag className={cn("type-toolbar-title truncate", className)}>{children}</Tag>;
}

export function PageTitle({ children, className, as: Tag = "h1" }: TypographyProps) {
  return <Tag className={cn("type-page-title", className)}>{children}</Tag>;
}

export function SectionTitle({ children, className, as: Tag = "h2" }: TypographyProps) {
  return <Tag className={cn("type-section-title", className)}>{children}</Tag>;
}

export function SubsectionTitle({ children, className, as: Tag = "h3" }: TypographyProps) {
  return <Tag className={cn("type-subsection-title", className)}>{children}</Tag>;
}

export function CardTitle({ children, className, as: Tag = "h3" }: TypographyProps) {
  return <Tag className={cn("type-card-title", className)}>{children}</Tag>;
}

export function Eyebrow({
  children,
  className,
  brand = false,
  as: Tag = "p",
}: TypographyProps & { brand?: boolean }) {
  return (
    <Tag className={cn(brand ? "type-eyebrow-brand" : "type-eyebrow", className)}>{children}</Tag>
  );
}

export function Lead({ children, className, as: Tag = "p" }: TypographyProps) {
  return <Tag className={cn("type-lead", className)}>{children}</Tag>;
}

export function StatValue({ children, className, as: Tag = "p" }: TypographyProps) {
  return <Tag className={cn("type-stat", className)}>{children}</Tag>;
}

export function HeroTitle({ children, className, as: Tag = "h1" }: TypographyProps) {
  return <Tag className={cn("type-hero", className)}>{children}</Tag>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  eyebrowBrand = false,
  className,
}: {
  eyebrow?: string;
  title?: string;
  description?: ReactNode;
  eyebrowBrand?: boolean;
  className?: string;
}) {
  if (!eyebrow && !title && !description) return null;

  return (
    <header className={cn("max-w-3xl", className)}>
      {eyebrow ? <Eyebrow brand={eyebrowBrand}>{eyebrow}</Eyebrow> : null}
      {title ? <PageTitle className={eyebrow ? "mt-1" : undefined}>{title}</PageTitle> : null}
      {description ? (
        <div className={cn("type-lead", title || eyebrow ? "mt-2" : undefined)}>{description}</div>
      ) : null}
    </header>
  );
}

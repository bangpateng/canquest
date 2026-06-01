import { PageHeader } from "@/components/ui/typography";
import { cn } from "@/lib/utils/utils";

/** Same content column width on every platform menu (Overview, Quest, Earn, …). */
export const platformContentClass = "mx-auto w-full min-w-0 max-w-7xl";

/** Shared vertical rhythm for platform pages */
export function PlatformPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(platformContentClass, "space-y-6 md:space-y-8", className)}>{children}</div>
  );
}

export function PlatformPageIntro({
  eyebrow,
  title,
  description,
  eyebrowBrand = false,
  className,
}: {
  eyebrow?: string;
  title?: string;
  description?: React.ReactNode;
  eyebrowBrand?: boolean;
  className?: string;
}) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      eyebrowBrand={eyebrowBrand}
      className={className}
    />
  );
}

import { PageHeader } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/** Shared platform content width — matches Earn / Quest / Wallet layout */
export function PlatformPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full min-w-0 space-y-6", className)}>{children}</div>
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

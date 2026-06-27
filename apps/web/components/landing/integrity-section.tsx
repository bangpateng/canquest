import { SecuritySection } from "@/components/landing/security-section";

/**
 * Landing alias for the integrity / anti-sybil story.
 * Kept as its own module so the landing page reads as a distinct narrative beat
 * independent of where SecuritySection may be reused elsewhere.
 */
export function IntegritySection() {
  return <SecuritySection />;
}

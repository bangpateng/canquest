export function slugify(input: string, maxLen = 80): string {
  const s = input
    .toLowerCase()
    .normalize("NFKD")
    // remove diacritics
    .replace(/[\u0300-\u036f]/g, "")
    // replace non-alphanum with dashes
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  if (!s) return "campaign";
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen).replace(/-+$/g, "");
}


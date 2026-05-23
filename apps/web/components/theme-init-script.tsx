import { THEME_STORAGE_KEY } from "@/components/providers/theme-provider";

/** Runs before paint to avoid theme flash on load. */
export function ThemeInitScript() {
  const script = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var th=t==="light"?"light":"dark";var d=document.documentElement;d.classList.remove("light","dark");d.classList.add(th);d.style.colorScheme=th;}catch(e){document.documentElement.classList.add("dark");}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

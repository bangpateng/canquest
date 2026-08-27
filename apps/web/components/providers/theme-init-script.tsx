import { THEME_STORAGE_KEY } from "@/components/providers/theme-provider";

/** Runs before paint to avoid theme flash on load.
 *
 *  Dark-first web3 aesthetic: neon Canton green/cyan glows on deep black,
 *  glassmorphic cards, gradient mesh background — modern crypto dapp look. */
export function ThemeInitScript() {
  const script = `(function(){try{localStorage.removeItem("${THEME_STORAGE_KEY}");}catch(e){}var d=document.documentElement;d.classList.remove("light","dark");d.classList.add("dark");d.style.colorScheme="dark";})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

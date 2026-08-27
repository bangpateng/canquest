import { THEME_STORAGE_KEY } from "@/components/providers/theme-provider";

/** Runs before paint to avoid theme flash on load.
 *
 *  App adalah light-only: preferensi lama "dark" di localStorage pengguna
 *  (dari era dark-only) diabaikan dan selalu dipaksa ke light, lalu key lama
 *  dibersihkan supaya tidak kembali memicu apa pun. */
export function ThemeInitScript() {
  const script = `(function(){try{localStorage.removeItem("${THEME_STORAGE_KEY}");}catch(e){}var d=document.documentElement;d.classList.remove("light","dark");d.classList.add("light");d.style.colorScheme="light";})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

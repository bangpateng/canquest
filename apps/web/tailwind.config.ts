import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    // Class strings juga hidup di lib/ (mis. filterTabClass / pagination di
    // ui-button-styles). Tanpa glob ini Tailwind mempurge utility yang hanya
    // direferensikan dari lib/ — bug "tab terpilih gelap" (bg-gradient-brand).
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        heading: ["var(--font-space)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

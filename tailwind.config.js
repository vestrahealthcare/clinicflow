/** @type {import('tailwindcss').Config} */
module.exports = {
  // Dark mode follows the device setting, except inside a ".light" wrapper (used on the
  // black background pages, where the room squares stay white whatever the device setting).
  darkMode: ["variant", ["@media (prefers-color-scheme: dark) { &:not(.light *) }"]],
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"]
      },
      colors: {
        vacant: "#2F9E6E",
        prepping: "#7654C9",
        readydoc: "#C9820F",
        withdoc: "#3568C4",
        cleanup: "#B23A2C",
        lockout: "#7A1F17",
        housekeeping: "#8A5A34"
      },
      keyframes: {
        flash: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(178,58,44,0.55)" },
          "50%": { boxShadow: "0 0 0 6px rgba(178,58,44,0)" }
        }
      },
      animation: {
        flash: "flash 1.1s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

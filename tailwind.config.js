/** @type {import('tailwindcss').Config} */
module.exports = {
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

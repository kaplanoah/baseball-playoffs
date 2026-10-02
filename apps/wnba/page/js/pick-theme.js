// Picks the theme before the first paint, so Walnut never flashes Maple. It loads as a plain
// script in each page's head; js/appearance.js keeps the theme, and the icons and bar color that
// go with it, current.
try {
  const choice = localStorage.getItem("appearance");
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = choice === "dark" || (choice !== "light" && prefersDark);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}

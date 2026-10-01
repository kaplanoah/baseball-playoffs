// The settings panel's appearance choice: Maple, Walnut, or Automatic to follow the phone. Each
// device keeps its own, since the page saves nothing to the store. The page's head sets the theme
// before the first paint; this keeps it, and the icons and bar color that go with it, current.

const STORAGE_KEY = "appearance";
const CHOICES = ["auto", "light", "dark"];
const THEMES = {
  light: { barColor: "#e9d4b0", tabIcon: "icon-light.svg", homeScreenIcon: "icon-light-180.png" },
  dark: { barColor: "#1d1511", tabIcon: "icon.svg", homeScreenIcon: "icon-180.png" },
};

// A home-screen page keeps its settings apart from the browser's, so matching the icon takes
// choosing again in the browser.
const HOME_SCREEN_NOTE =
  "Apple sets a home-screen icon only when the page is added. To match this look, choose it in your browser and add the page again.";

const darkScheme = matchMedia("(prefers-color-scheme: dark)");
const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

// Storage can be off, as in a private window, and then the page follows the phone.
function readChoice() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return CHOICES.includes(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

/** @param {string} choice */
function saveChoice(choice) {
  try {
    if (choice === "auto") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // The choice still applies until the page reloads.
  }
}

/** @param {string} choice */
const resolveTheme = (choice) => {
  if (choice !== "auto") return choice;
  return darkScheme.matches ? "dark" : "light";
};

// A phone keeps the icon a page offers at the moment it's added to the home screen, so the page
// offers the one that matches the theme showing.
/** @param {"light" | "dark"} theme */
function showTheme(theme) {
  const { barColor, tabIcon, homeScreenIcon } = THEMES[theme];
  document.documentElement.dataset.theme = theme;
  findElement("themeColor").setAttribute("content", barColor);
  findElement("tabIcon").setAttribute("href", tabIcon);
  findElement("homeScreenIcon").setAttribute("href", homeScreenIcon);
}

export function startAppearance() {
  const picker = /** @type {HTMLSelectElement} */ (findElement("appearanceSel"));
  picker.value = readChoice();
  const showChosenTheme = () =>
    showTheme(/** @type {"light" | "dark"} */ (resolveTheme(picker.value)));
  showChosenTheme();
  picker.addEventListener("change", () => {
    saveChoice(picker.value);
    showChosenTheme();
    findElement("appearanceNote").textContent = HOME_SCREEN_NOTE;
  });
  darkScheme.addEventListener("change", showChosenTheme);
}

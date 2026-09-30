// A phone keeps the icon a page offers at the moment it's added to the home screen, so the page
// offers the one that matches the phone's light or dark setting: maple or walnut.
const ICONS = { light: "icon-light-180.png", dark: "icon-180.png" };

export function matchHomeScreenIcon() {
  const lightScheme = matchMedia("(prefers-color-scheme: light)");
  const link = /** @type {HTMLLinkElement} */ (document.getElementById("homeScreenIcon"));
  const chooseIcon = () =>
    link.setAttribute("href", lightScheme.matches ? ICONS.light : ICONS.dark);
  chooseIcon();
  lightScheme.addEventListener("change", chooseIcon);
}

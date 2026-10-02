/**
 * Every piece of shown text off the apps' type scale, with what sets it and why. Sizes are as
 * drawn, after the font's size-adjust: nothing under 13px, uppercase under 16px at least 500,
 * weights 400 to 600 under 24px and 300 to 700 from there, and Barlow Condensed never over 600.
 * The tab bar's labels keep the phone's own size, and text hidden for screen readers is left out.
 * @param {import("@playwright/test").Page} page
 */
export const listOffScaleText = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const SMALLEST_SIZE = 13;
    const LARGE_SIZE = 24;
    const SMALL_CAPS_SIZE = 16;
    const HEAVIEST_CONDENSED = 600;

    /** @param {string} family */
    const readSizeAdjust = (family) => {
      const face = [...document.fonts].find(
        (font) => font.family.replaceAll('"', "") === family && font.status === "loaded",
      );
      // TypeScript's DOM types don't list FontFace's sizeAdjust yet.
      const sizeAdjust = face && /** @type {FontFace & { sizeAdjust: string }} */ (face).sizeAdjust;
      return sizeAdjust ? parseFloat(sizeAdjust) / 100 : 1;
    };

    /** @param {number} size @param {number} weight */
    const describeWeightProblem = (size, weight) => {
      const [lightest, heaviest] = size < LARGE_SIZE ? [400, 600] : [300, 700];
      if (weight < lightest || weight > heaviest)
        return `weight ${weight} outside ${lightest}-${heaviest}`;
      return "";
    };

    /** @param {Element} element */
    const isScreenReaderOnly = (element) => {
      const box = element.getBoundingClientRect();
      return box.width <= 1 || box.height <= 1;
    };

    /** A chart's text is drawn at its font size times the scale its SVG is shown at. @param {Element} element */
    const readDrawnScale = (element) =>
      element instanceof SVGGraphicsElement ? (element.getScreenCTM()?.a ?? 1) : 1;

    /** @param {Element} element */
    const listProblems = (element) => {
      const style = getComputedStyle(element);
      const family = style.fontFamily.split(",")[0].replaceAll('"', "").trim();
      const size = parseFloat(style.fontSize) * readSizeAdjust(family) * readDrawnScale(element);
      const weight = Number(style.fontWeight);
      const isUppercase = style.textTransform === "uppercase";
      return [
        size < SMALLEST_SIZE - 0.01 ? `size ${size.toFixed(1)}px under ${SMALLEST_SIZE}px` : "",
        describeWeightProblem(size, weight),
        isUppercase && size < SMALL_CAPS_SIZE && weight < 500 ? `uppercase at ${weight}` : "",
        family === "Barlow Condensed" && weight > HEAVIEST_CONDENSED
          ? `Barlow Condensed at ${weight}`
          : "",
      ].filter(Boolean);
    };

    const offScale = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || !node.textContent?.trim() || !element.checkVisibility()) continue;
      if (element.closest(".tab-label") || isScreenReaderOnly(element)) continue;
      const problems = listProblems(element);
      if (problems.length)
        offScale.add(
          `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}: ${problems.join(", ")}`,
        );
    }
    return [...offScale];
  });

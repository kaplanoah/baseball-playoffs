/**
 * Every piece of shown text off the apps' type scale, with what sets it and why. Sizes and weights
 * are Barlow's: a font's size-adjust makes its size look like Barlow's at that size, and Chivo
 * Mono reads heavier, so its weights count 50 more. Nothing is under 13px, capitals under 16px are
 * at least 500, weights are 400 to 600 under 24px and 300 to 700 from there, and Barlow Condensed
 * never goes over 600. The tab bar's labels keep the phone's own size, and text hidden for screen
 * readers is left out.
 * @param {import("@playwright/test").Page} page
 */
export const listOffScaleText = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const SMALLEST_SIZE = 13;
    const LARGE_SIZE = 24;
    const SMALL_CAPS_SIZE = 16;
    const HEAVIEST_CONDENSED = 600;
    /** @type {Record<string, number>} */
    const WEIGHT_SHIFTS = { "Chivo Mono": 50 };

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
      const size = parseFloat(style.fontSize) * readDrawnScale(element);
      const weight = Number(style.fontWeight) + (WEIGHT_SHIFTS[family] ?? 0);
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

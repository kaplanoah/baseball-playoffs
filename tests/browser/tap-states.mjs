/**
 * The buttons and disclosures on the page that a phone would flash gray when tapped.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
export const listTapFlashes = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button, summary")]
      .filter(
        (element) =>
          getComputedStyle(element).getPropertyValue("-webkit-tap-highlight-color") !==
          "rgba(0, 0, 0, 0)",
      )
      .map((element) => element.outerHTML.slice(0, 80)),
  );

/**
 * The page's :hover rules that a phone would also apply, and keep, after a tap: those outside a
 * `(hover: hover)` media rule.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
export const listTouchHoverRules = (page) =>
  page.evaluate(() => {
    /** @param {CSSRuleList} rules @param {boolean} isHoverOnly @returns {string[]} */
    const findHoverRules = (rules, isHoverOnly) =>
      [...rules].flatMap((rule) => {
        if (rule instanceof CSSMediaRule)
          return findHoverRules(
            rule.cssRules,
            isHoverOnly || rule.conditionText.includes("(hover: hover)"),
          );
        const isTouchHover =
          rule instanceof CSSStyleRule && rule.selectorText.includes(":hover") && !isHoverOnly;
        return isTouchHover ? [rule.selectorText] : [];
      });
    return [...document.styleSheets].flatMap((sheet) => findHoverRules(sheet.cssRules, false));
  });

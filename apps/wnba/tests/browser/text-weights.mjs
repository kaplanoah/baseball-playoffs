/**
 * Every weight heavier than 600 that shown text has, with what sets it, leaving out the Games
 * list's calendar day numbers.
 * @param {import("@playwright/test").Page} page
 */
export const listHeavyText = (page) =>
  page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const heavy = new Set();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || !node.textContent?.trim() || element.closest(".day-number")) continue;
      if (!element.checkVisibility()) continue;
      const weight = Number(getComputedStyle(element).fontWeight);
      if (weight > 600)
        heavy.add(`${element.tagName.toLowerCase()}.${element.className}: ${weight}`);
    }
    return [...heavy];
  });

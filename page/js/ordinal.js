export function formatOrdinal(number) {
  const lastTwoDigits = number % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${number}th`;
  return number + ({ 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th");
}

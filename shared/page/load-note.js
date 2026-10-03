// The page's first drawing replaces the note slow-load.js shows while its views are empty.
export function endLoadNote() {
  document.getElementById("loadNote")?.remove();
}

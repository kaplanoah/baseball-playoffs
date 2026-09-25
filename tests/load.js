/* Loads the page's scripts into one sandbox, the way the browser loads them
   into one page: top-level functions and consts land in a shared scope, so a
   test can call them by name through run(). Only what these scripts touch at
   load time is stubbed; anything that needs a real page belongs in the
   browser, not here. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadPage(files) {
  const ctx = vm.createContext({ console, setInterval: () => 0, Date, Math, JSON });
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
    vm.runInContext(src, ctx, { filename: f });
  }
  return {
    run: (code, vars = {}) => {
      Object.assign(ctx, vars);
      return vm.runInContext(code, ctx);
    },
  };
}

/* toLocaleTimeString puts a narrow no-break space before AM/PM. Tests
   compare against a plain space, which is what anyone would type. */
const plain = (s) => (typeof s === "string" ? s.replace(/\u202f/g, " ") : s);

module.exports = { loadPage, plain };

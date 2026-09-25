const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadPage(files) {
  const ctx = vm.createContext({ console, setInterval: () => 0, Date, Math, JSON });
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, "..", "page", "js", f), "utf8");
    vm.runInContext(src, ctx, { filename: f });
  }
  return {
    run: (code, vars = {}) => {
      Object.assign(ctx, vars);
      return vm.runInContext(code, ctx);
    },
  };
}

// toLocaleTimeString puts a narrow no-break space (U+202F) before AM/PM.
const plain = (s) => (typeof s === "string" ? s.replace(/\u202f/g, " ") : s);

module.exports = { loadPage, plain };

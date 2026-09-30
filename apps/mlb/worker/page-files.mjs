import { fileURLToPath } from "node:url";
import { readPageFiles } from "../../../worker/page-files.mjs";

export default readPageFiles(fileURLToPath(new URL("../page/", import.meta.url)));

// Sets the plugin version in manifest.json, package.json and versions.json.
//   npm run bump -- 0.2.0
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: npm run bump -- x.y.z");
  process.exit(1);
}
const rw = (file, edit) => {
  const p = join(root, file), j = JSON.parse(readFileSync(p, "utf8"));
  edit(j);
  writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
};
let minApp;
rw("manifest.json", (m) => { m.version = version; minApp = m.minAppVersion; });
rw("package.json", (p) => { p.version = version; });
rw("versions.json", (v) => { v[version] = minApp; });
rw("package-lock.json", (l) => { l.version = version; if (l.packages?.[""]) l.packages[""].version = version; });
console.log(`version ${version} (minAppVersion ${minApp})`);

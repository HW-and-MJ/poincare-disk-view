// Build main.js (and, in the development repo, copy the plugin files into the dev vault).
// `node esbuild.config.mjs` watches; `node esbuild.config.mjs production` builds once, minified.
import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const prod = process.argv[2] === "production";
const { id } = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
// Only in the development repo: the dev vault next to this folder gets a copy of every build.
const devVault = join(here, "..", "DevVault");
const pluginDir = join(devVault, ".obsidian", "plugins", id);

const copyToVault = {
  name: "copy-to-dev-vault",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length || !existsSync(devVault)) return;
      mkdirSync(pluginDir, { recursive: true });
      for (const f of ["main.js", "manifest.json", "styles.css"]) {
        copyFileSync(join(here, f), join(pluginDir, f));
      }
      console.log(`[${new Date().toLocaleTimeString()}] copied to ${pluginDir}`);
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: [join(here, "src/main.ts")],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: join(here, "main.js"),
  plugins: [copyToVault],
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}

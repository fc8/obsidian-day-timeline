import esbuild from "esbuild";
import { builtinModules } from "node:module";
import process from "node:process";

const production = process.argv[2] === "production";

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  target: "es2018",
  platform: "browser",
  external: [
    "obsidian",
    "electron",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  logLevel: "info",
  treeShaking: true,
  minify: production,
  sourcemap: production ? false : "inline",
  banner: { js: "/* Day Timeline · Obsidian plugin */" },
};

if (production) {
  await esbuild.build(options);
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching for changes...");
}

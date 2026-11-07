import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

/**
 * 模拟 Obsidian 审核的 no-unsupported-api：把 src/ 里每个属性访问的符号
 * 解析到 obsidian.d.ts，读取声明上的 @since，确认不高于 manifest 的 minAppVersion。
 * 内部 API（不在 obsidian.d.ts 里）不参与检查。
 */
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
const minAppVersion = manifest.minAppVersion;

assert.ok(/^\d+\.\d+\.\d+$/.test(minAppVersion), "minAppVersion 必须是完整的三段版本号");
assert.equal(versions[manifest.version], minAppVersion, "versions.json 必须与 manifest.json 的最低版本一致");

const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
assert.ok(!config.error, "tsconfig.json 应可读");
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
const checker = program.getTypeChecker();

const normalize = (file) => file.replace(/\\/g, "/");
const compare = (a, b) => {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
  }
  return 0;
};

let hasTypings = false;
const seen = new Set();
const usages = [];
const violations = [];

for (const source of program.getSourceFiles()) {
  const file = normalize(source.fileName);
  if (file.includes("/obsidian/obsidian.d.ts")) hasTypings = true;
  if (!file.includes("/src/") || !file.endsWith(".ts")) continue;

  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const symbol = checker.getSymbolAtLocation(node.name);
      for (const declaration of symbol?.declarations ?? []) {
        const declFile = normalize(declaration.getSourceFile().fileName);
        if (!declFile.includes("/obsidian/obsidian.d.ts")) continue;
        const sinceTag = ts.getJSDocTags(declaration).find((tag) => tag.tagName.text === "since");
        const since = typeof sinceTag?.comment === "string" ? sinceTag.comment.trim() : "";
        if (!/^\d+\.\d+\.\d+$/.test(since)) continue;
        const pos = source.getLineAndCharacterOfPosition(node.name.getStart());
        const key = `${path.basename(source.fileName)}:${pos.line + 1} ${node.name.text} @since ${since}`;
        if (seen.has(key)) continue;
        seen.add(key);
        usages.push({ key, since });
        if (compare(since, minAppVersion) > 0) violations.push(key);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

assert.ok(hasTypings, "TypeScript program 应包含 obsidian.d.ts");
assert.ok(usages.length > 0, "应至少解析出一个带 @since 的 Obsidian API 调用");
assert.deepEqual(
  violations,
  [],
  `以下 API 需要的 Obsidian 版本高于 minAppVersion ${minAppVersion}：\n${violations.join("\n")}`,
);

const highest = usages.reduce((max, item) => (compare(item.since, max) > 0 ? item.since : max), "0.0.0");
console.log(`API 兼容性: minAppVersion ${minAppVersion} / versions.json 一致 / ${usages.length} 处版本化 API 调用，最高 @since ${highest}，无超纲`);

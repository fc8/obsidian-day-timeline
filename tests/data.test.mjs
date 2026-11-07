import esbuild from "esbuild";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

fs.writeFileSync(".tmp-entry.ts", 'export * from "./src/utils";\nexport * from "./src/data";\n');

const STUB = `
exports.setIcon = function(){};
exports.normalizePath = function(p){ return String(p).split("/").filter(Boolean).join("/"); };
`;

await esbuild.build({
  entryPoints: [".tmp-entry.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: ".tmp-data.cjs",
  logLevel: "silent",
  plugins: [{
    name: "stub-obsidian",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: STUB, loader: "js" }));
    },
  }],
});

const mod = require("../.tmp-data.cjs");

// ---- 1. 日期识别 ----
const dateCases = [
  ["2026-11-07", "2026-11-07"],
  ["日记 2026.11.7", "2026-11-07"],
  ["2026年11月7日 星期六", "2026-11-07"],
  ["20261107", "2026-11-07"],
  ["2026-11-07 日记", "2026-11-07"],
  ["2026_11_07", "2026-11-07"],
];
for (const [input, expected] of dateCases) {
  const parsed = mod.parseDateInName(input);
  assert.ok(parsed, `未识别日期: ${input}`);
  assert.equal(mod.toDateKey(parsed), expected, `识别错误: ${input}`);
}
assert.equal(mod.parseDateInName("没有日期的随笔"), null);
assert.equal(mod.parseDateInName("2026-13-45"), null);
console.log(`日期识别: ${dateCases.length} 种格式 + 2 个反例通过`);

// ---- 2. 格式化与模板 ----
const sample = new Date(2026, 10, 7);
assert.equal(mod.formatDate(sample, "YYYY-MM-DD"), "2026-11-07");
assert.equal(mod.formatDate(sample, "YYYY年M月D日 dddd"), "2026年11月7日 星期六");
assert.equal(mod.formatDate(sample, "YYYYMMDD"), "20261107");
assert.equal(
  mod.renderNoteTemplate("## {{date:YYYY年M月D日}}\\n\\n{{date}}", sample),
  "## 2026年11月7日\n\n2026-11-07",
);
console.log("日期格式 / 新建模板: 通过");

// ---- 3. 模拟 vault 扫描 ----
const contents = new Map();
const frontmatters = new Map();
const makeFile = (path, content, frontmatter) => {
  contents.set(path, content);
  if (frontmatter) frontmatters.set(path, frontmatter);
  return { path, basename: path.split("/").pop().replace(/\.md$/, ""), stat: { ctime: Date.now() }, extension: "md" };
};

const files = [
  makeFile("日记/2026-11-07.md", `---\ntags: [生活, 摄影]\n---\n# 今天\n\n去江边 **走了走**，拍了照片。\n\n![[晚霞.jpg]]\n![](assets/咖啡.png)\n`, { tags: ["生活", "摄影"] }),
  makeFile("日记/2026-11-07 晚间.md", "晚上又补了一段，#随记", undefined),
  makeFile("日记/2026年11月6日.md", "昨天下了雨。", undefined),
  makeFile("日记/随笔.md", "frontmatter 指定日期", { date: "2026-11-05", title: "一篇随笔" }),
  makeFile("模板/模板.md", "这是模板，不该进时间线", undefined),
  makeFile("其他/无日期.md", "没有日期，也不该进时间线", undefined),
];

const app = {
  vault: {
    getMarkdownFiles: () => files,
    cachedRead: async (file) => contents.get(file.path) ?? "",
    getResourcePath: (file) => `app://local/${file.path}`,
  },
  metadataCache: {
    getFileCache: (file) => ({ frontmatter: frontmatters.get(file.path) }),
    getFirstLinkpathDest: (link) => ({ path: `attachments/${link}` }),
  },
  internalPlugins: {
    getPluginById: () => ({ instance: { options: { folder: "日记", format: "YYYY-MM-DD" } } }),
  },
};

const settings = {
  followDailyNotes: true,
  noteFolder: "",
  dateFormat: "YYYY-MM-DD",
  dateField: "date, created, 日期",
  excludeFolders: "模板, templates",
  fallbackToFileDate: false,
  sortOrder: "desc",
  excerptLength: 180,
  showImages: true,
  maxImagesPerDay: 4,
  showTags: true,
  groupByMonth: true,
  pageSize: 30,
  noteTemplate: "",
};

const entries = await mod.collectEntries(app, settings);
assert.equal(entries.length, 4, "应扫描出 4 篇日记");
const days = mod.groupDays(entries, "desc");
assert.equal(days.length, 3, "应聚合成 3 天");
assert.equal(days[0].dateKey, "2026-11-07", "倒序时最新一天在最前");
assert.equal(days[0].entries.length, 2, "同一天的两篇应合并");
assert.equal(days[0].images.length, 2, "应解析出 2 张图片");
assert.ok(days[0].images[0].url.startsWith("app://local/"), "图片应转换为资源路径");
assert.ok(days[0].entries.some((entry) => entry.excerpt.includes("去江边 走了走")), "摘要应去掉 Markdown 标记");
assert.ok(!days[0].entries.some((entry) => entry.excerpt.includes("![[")), "摘要不应保留图片语法");
assert.ok(days[0].tags.includes("生活") && days[0].tags.includes("随记"), "应收集 frontmatter 与行内标签");
assert.equal(entries.find((e) => e.file.basename === "随笔").dateKey, "2026-11-05", "frontmatter 日期应优先");
assert.equal(entries.find((e) => e.file.basename === "随笔").title, "一篇随笔", "应读取 frontmatter 标题");
console.log(`仓库扫描: ${entries.length} 篇 / ${days.length} 天 / ${days[0].images.length} 张图 / 标签与摘要提取通过`);

// ---- 4. 新建日记路径 ----
assert.equal(mod.diaryPathFor(app, settings, new Date(2026, 10, 8)), "日记/2026-11-08.md");
assert.equal(
  mod.diaryPathFor(app, { ...settings, followDailyNotes: false, noteFolder: "我的日记" }, new Date(2026, 10, 8)),
  "我的日记/2026-11-08.md",
);
console.log("新建日记路径: 跟随核心插件 / 自定义文件夹均通过");

fs.rmSync(".tmp-entry.ts");
fs.rmSync(".tmp-data.cjs");
console.log("数据层测试全部通过");

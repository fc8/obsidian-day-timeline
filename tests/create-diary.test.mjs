import esbuild from "esbuild";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const TMP = ".tmp-create.cjs";

// 完整打包 main.ts，并把 Obsidian 运行时换成可观测的桩
const STUB = `
class Plugin { constructor(app, manifest) { this.app = app; this.manifest = manifest; } }
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = {}; } }
class ItemView { constructor(leaf) { this.leaf = leaf; this.contentEl = {}; } }
class Setting { constructor(el) { this.el = el; } setName(){ return this; } setDesc(){ return this; } addText(){ return this; } addToggle(){ return this; } addSlider(){ return this; } addDropdown(){ return this; } }
class Notice { constructor(message) { globalThis.__ltNotices.push(String(message)); } }
class TFile {}
class App {}
globalThis.__ltTFile = TFile;
exports.Plugin = Plugin;
exports.PluginSettingTab = PluginSettingTab;
exports.ItemView = ItemView;
exports.Setting = Setting;
exports.Notice = Notice;
exports.TFile = TFile;
exports.App = App;
exports.Platform = { isMobile: false, isDesktop: true };
exports.setIcon = function () {};
exports.normalizePath = function (p) { return String(p).split("/").filter(Boolean).join("/"); };
`;

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: TMP,
  logLevel: "silent",
  plugins: [{
    name: "stub-obsidian",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: STUB, loader: "js" }));
    },
  }],
});

globalThis.__ltNotices = [];
const DayTimelinePlugin = require("../" + TMP).default;
const TFile = globalThis.__ltTFile;

const SETTINGS = {
  followDailyNotes: false,
  noteFolder: "日记",
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

const makeFile = (path, mtime) => Object.assign(new TFile(), {
  path,
  basename: path.split("/").pop().replace(/\.md$/, ""),
  extension: "md",
  stat: { ctime: 1, mtime: mtime ?? 1 },
});

/** paths: [路径, mtime][]，返回一次「写日记」调用后的可观测结果 */
async function run(paths, date, frontmatters = {}, settings = {}) {
  const files = new Map(paths.map(([path, mtime]) => [path, makeFile(path, mtime)]));
  const created = [];
  const opened = [];

  const app = {
    vault: {
      getMarkdownFiles: () => Array.from(files.values()),
      getAbstractFileByPath: (path) => files.get(path) ?? null,
      cachedRead: async () => "",
      getResourcePath: () => "",
      createFolder: async () => {},
      create: async (path, content) => {
        created.push({ path, content });
        const file = makeFile(path);
        files.set(path, file);
        return file;
      },
    },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: frontmatters[file.path] }),
      getFirstLinkpathDest: () => null,
    },
    workspace: {
      getLeaf: () => ({ openFile: async (file) => { opened.push(file.path); } }),
    },
    internalPlugins: { getPluginById: () => null },
  };

  const plugin = new DayTimelinePlugin(app, { id: "day-timeline" });
  plugin.settings = { ...SETTINGS, ...settings };
  globalThis.__ltNotices.length = 0;
  await plugin.createDiary(date);
  return { created, opened, notices: [...globalThis.__ltNotices] };
}

const TODAY = new Date(2026, 10, 7);
let r;

// 1. 标准日期路径已存在：直接打开，不创建
r = await run([["日记/2026-11-07.md"]], TODAY);
assert.deepEqual(r.opened, ["日记/2026-11-07.md"]);
assert.equal(r.created.length, 0, "已有标准日记时不应创建");

// 2. 文件名带后缀：旧逻辑会漏判并新建，现在应打开已有
r = await run([["日记/2026-11-07 晚间.md"]], TODAY);
assert.deepEqual(r.opened, ["日记/2026-11-07 晚间.md"]);
assert.equal(r.created.length, 0, "文件名带后缀时不应创建第二篇");
assert.ok(r.notices.some((m) => m.includes("已打开当天日记")), "应提示打开的是已有日记");

// 3. 使用了其他日期格式
r = await run([["日记/2026年11月7日.md"]], TODAY);
assert.deepEqual(r.opened, ["日记/2026年11月7日.md"]);
assert.equal(r.created.length, 0, "其他日期格式也应识别为当天日记");

// 4. 日期写在 frontmatter 里
r = await run([["日记/随笔.md"]], TODAY, { "日记/随笔.md": { date: "2026-11-07" } });
assert.deepEqual(r.opened, ["日记/随笔.md"]);
assert.equal(r.created.length, 0, "frontmatter 指定的日期也应识别");

// 5. 同一天有多篇：优先打开最近编辑的那一篇并提示篇数
r = await run([["日记/2026-11-07 早.md", 100], ["日记/2026-11-07 晚.md", 900]], TODAY);
assert.deepEqual(r.opened, ["日记/2026-11-07 晚.md"]);
assert.equal(r.created.length, 0);
assert.ok(r.notices.some((m) => m.includes("已有 2 篇日记")), "多篇时应说明打开了最近编辑的一篇");

// 6. 当天确实没有日记：按配置格式创建并打开
r = await run([["日记/2026-11-06.md"]], TODAY);
assert.equal(r.created.length, 1, "无当天日记时应创建");
assert.equal(r.created[0].path, "日记/2026-11-07.md");
assert.deepEqual(r.opened, ["日记/2026-11-07.md"]);
assert.ok(r.notices.some((m) => m.includes("已创建日记")));

// 7. 排除文件夹 / 非日记文件夹里的同日文件不算当天日记
r = await run([["模板/2026-11-07.md"]], TODAY);
assert.equal(r.created.length, 1, "模板文件不应被当成当天日记");
assert.equal(r.created[0].path, "日记/2026-11-07.md");

// 8. 日历里点过去的空白日期，同样先找该日已有日记
r = await run([["日记/2026-11-05 周末.md"]], new Date(2026, 10, 5));
assert.deepEqual(r.opened, ["日记/2026-11-05 周末.md"]);
assert.equal(r.created.length, 0, "历史日期也不应重复创建");

fs.rmSync(TMP, { force: true });
console.log("写日记入口: 8 组场景通过（标准路径 / 后缀 / 其他格式 / frontmatter / 多篇 / 新建 / 排除文件夹 / 历史日期）");

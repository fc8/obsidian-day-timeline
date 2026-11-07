/**
 * 生成 README 用的界面截图。
 *
 * 依赖本机 Chrome / Edge + puppeteer-core（不随插件打包，也不进 devDependencies）：
 *   npm install --no-save puppeteer-core
 *   node scripts/capture-screenshots.mjs
 *
 * 也可通过环境变量指定浏览器：CHROME_PATH="C:\\Program Files\\...\\chrome.exe"
 * 截图内容来自 preview.html —— 它与插件共用同一份 styles.css，只是数据是示例数据。
 */

import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "screenshots");
const PREVIEW = pathToFileURL(path.join(ROOT, "preview.html")).href;

let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.error("缺少 puppeteer-core，请先运行：npm install --no-save puppeteer-core");
  process.exit(1);
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error("未找到 Chrome / Edge，请设置 CHROME_PATH 环境变量指向浏览器可执行文件。");
  process.exit(1);
}

const PAD = 22;
const SCENES = [
  {
    name: "timeline-light",
    title: "桌面 · 浅色 · 完整时间线",
    device: "desktop",
    dark: false,
    actions: [],
    stageW: 1080,
    stageH: 780,
    bg: "#eef0f5",
  },
  {
    name: "calendar-light",
    title: "桌面 · 浅色 · 日历视图",
    device: "desktop",
    dark: false,
    actions: ["calendar"],
    stageW: 1080,
    stageH: 780,
    bg: "#eef0f5",
  },
  {
    name: "memory-dark",
    title: "桌面 · 深色 · 那年今天",
    device: "desktop",
    dark: true,
    actions: ["memory"],
    stageW: 1080,
    stageH: 780,
    bg: "#16161c",
  },
  {
    name: "mobile-timeline",
    title: "手机 · 浅色 · 完整时间线",
    device: "phone",
    dark: false,
    actions: [],
    stageW: 390,
    stageH: 760,
    bg: "#eef0f5",
  },
  {
    name: "mobile-calendar",
    title: "手机 · 深色 · 日历视图",
    device: "phone",
    dark: true,
    actions: ["calendar"],
    stageW: 390,
    stageH: 760,
    bg: "#16161c",
  },
];

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--font-render-hinting=none",
    "--force-device-scale-factor=1",
  ],
});

try {
  for (const scene of SCENES) {
    const page = await browser.newPage();
    await page.setViewport({
      width: scene.stageW + PAD * 2,
      height: scene.stageH + PAD * 2,
      deviceScaleFactor: 2,
    });
    await page.goto(PREVIEW, { waitUntil: "domcontentloaded", timeout: 20000 });

    // 先切换状态，再注入截图尺寸（设备切换会改写 .demo-stage 的宽高）
    if (scene.device === "phone") await page.click('[data-device="phone"]');
    if (scene.dark) await page.click("#theme-toggle");
    for (const act of scene.actions) await page.click(`[data-act="${act}"]`);

    await page.addStyleTag({
      content: `
        .demo-toolbar, .demo-note { display: none !important; }
        html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
        html, body, body:has(.theme-dark) { background: ${scene.bg} !important; }
        .demo-stage {
          box-sizing: border-box !important;
          margin: ${PAD}px auto 0 !important;
          width: ${scene.stageW}px !important;
          height: ${scene.stageH}px !important;
          min-height: 0 !important;
          max-width: none !important;
        }
      `,
    });

    // 预览页的图片都是内联 SVG data URI，无需等待网络；留出解码与排版时间即可
    await new Promise((r) => setTimeout(r, 600));

    const dest = path.join(OUT, `${scene.name}.png`);
    await page.screenshot({ path: dest, type: "png" });
    console.log(`✓ ${scene.name}.png  ${scene.title}`);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\n截图已写入 ${OUT}`);

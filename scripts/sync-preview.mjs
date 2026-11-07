import fs from "node:fs";

// 预览页在某些静态预览服务里无法加载同目录的 styles.css，
// 因此把插件样式直接内联进 preview.html，保证任何环境下都能完整显示。
const css = fs.readFileSync("styles.css", "utf8").trim();
const file = "preview.html";
let html = fs.readFileSync(file, "utf8");
const block = `<style id="lt-styles">\n${css}\n</style>`;
const inlined = /<style id="lt-styles">[\s\S]*?<\/style>/;
const link = '<link rel="stylesheet" href="styles.css">';

if (inlined.test(html)) {
  html = html.replace(inlined, block);
} else if (html.includes(link)) {
  html = html.replace(link, block);
} else {
  throw new Error("preview.html 中没有找到样式占位符");
}

fs.writeFileSync(file, html);
console.log(`预览页已内联 ${css.length} 字节样式`);

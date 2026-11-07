import { normalizePath } from "obsidian";
import type { App, TFile } from "obsidian";
import type { TimelineSettings } from "./settings";
import {
  formatDate,
  isValidDate,
  parseDateInName,
  parseDateLike,
  resolveDailyNotesOptions,
  toDateKey,
} from "./utils";

export interface DiaryImage {
  url: string;
  alt: string;
}

export interface DiaryEntry {
  file: TFile;
  date: Date;
  dateKey: string;
  title: string;
  excerpt: string;
  images: DiaryImage[];
  tags: string[];
  charCount: number;
}

export interface DiaryDay {
  dateKey: string;
  date: Date;
  entries: DiaryEntry[];
  images: DiaryImage[];
  tags: string[];
  charCount: number;
}

export interface DiarySource {
  folder: string;
  format: string;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|heif)$/i;
const EXTERNAL = /^(https?:|data:|app:|file:|capacitor:)/i;

function cleanFolder(raw: string): string {
  return (raw ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/** 综合「跟随日记插件」与自定义设置，得到真正的扫描目录和文件名格式。 */
export function getDiarySource(app: App, settings: TimelineSettings): DiarySource {
  const daily = settings.followDailyNotes ? resolveDailyNotesOptions(app) : {};
  const folder = cleanFolder(settings.followDailyNotes ? (daily.folder ?? settings.noteFolder) : settings.noteFolder);
  const format = settings.followDailyNotes ? (daily.format || settings.dateFormat) : settings.dateFormat;
  return { folder, format: format || "YYYY-MM-DD" };
}

/** 生成某一天日记的路径（与 Obsidian「日记」核心插件保持一致）。 */
export function diaryPathFor(app: App, settings: TimelineSettings, date: Date): string {
  const source = getDiarySource(app, settings);
  const filename = formatDate(date, source.format) || toDateKey(date);
  const raw = source.folder ? `${source.folder}/${filename}.md` : `${filename}.md`;
  return normalizePath(raw).replace(/^\//, "");
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\r?\n/, "");
}

function makeExcerpt(body: string, limit: number): string {
  let text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, alias: string) => alias || target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > limit) text = `${text.slice(0, limit).replace(/\s+$/, "")}…`;
  return text;
}

function extractImages(app: App, file: TFile, body: string): DiaryImage[] {
  const images: DiaryImage[] = [];
  const seen = new Set<string>();
  const push = (url: string, alt: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push({ url, alt });
  };
  const resolveLocal = (link: string): string | null => {
    try {
      const target = app.metadataCache.getFirstLinkpathDest(decodeURIComponent(link), file.path);
      return target ? app.vault.getResourcePath(target) : null;
    } catch {
      return null;
    }
  };

  const wiki = /!\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wiki.exec(body)) !== null) {
    const parts = match[1].split("|");
    const link = parts[0].split("#")[0].trim();
    const alt = (parts[1] || link).trim();
    if (!IMAGE_EXT.test(link)) continue;
    if (EXTERNAL.test(link)) {
      push(link, alt);
    } else {
      const url = resolveLocal(link);
      if (url) push(url, alt);
    }
  }

  const markdown = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((match = markdown.exec(body)) !== null) {
    const link = match[2];
    const alt = match[1] || link;
    if (EXTERNAL.test(link)) {
      push(link, alt);
      continue;
    }
    if (!IMAGE_EXT.test(link)) continue;
    const url = resolveLocal(link);
    if (url) push(url, alt);
  }
  return images;
}

function extractTags(frontmatter: Record<string, unknown> | undefined, body: string): string[] {
  const tags = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const tag = value.trim().replace(/^#/, "");
    if (tag && tag.length < 30) tags.add(tag);
  };
  const raw = frontmatter?.tags ?? frontmatter?.tag;
  if (Array.isArray(raw)) raw.forEach(add);
  else add(raw);
  // (^|[^#]) 让中文标点后紧跟的 #标签 也能识别，同时排除 ##标题 这类 Markdown 标题
  const inline = /(^|[^#])#([\p{L}\p{N}_/-]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = inline.exec(body)) !== null) {
    add(match[2]);
    if (tags.size >= 8) break;
  }
  return Array.from(tags).slice(0, 8);
}

async function buildEntry(app: App, settings: TimelineSettings, file: TFile): Promise<DiaryEntry | null> {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
  let date: Date | null = null;

  for (const field of settings.dateField.split(",").map((item) => item.trim()).filter(Boolean)) {
    date = parseDateLike(frontmatter?.[field]);
    if (isValidDate(date)) break;
  }
  if (!isValidDate(date)) date = parseDateInName(file.basename);
  if (!isValidDate(date) && settings.fallbackToFileDate) date = new Date(file.stat.ctime);
  if (!isValidDate(date)) return null;

  let content: string;
  try {
    content = await app.vault.cachedRead(file);
  } catch {
    return null;
  }

  const body = stripFrontmatter(content);
  const title = typeof frontmatter?.title === "string" && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : file.basename;

  return {
    file,
    date,
    dateKey: toDateKey(date),
    title,
    excerpt: makeExcerpt(body, settings.excerptLength),
    images: settings.showImages ? extractImages(app, file, body) : [],
    tags: extractTags(frontmatter, body),
    charCount: body.replace(/\s/g, "").length,
  };
}

/** 扫描仓库并建立索引。分批读取内容，避免手机上一次性读几百个文件卡顿。 */
export async function collectEntries(app: App, settings: TimelineSettings): Promise<DiaryEntry[]> {
  const source = getDiarySource(app, settings);
  const excludes = settings.excludeFolders
    .split(",")
    .map(cleanFolder)
    .filter((item) => item.length > 0);

  const files = app.vault.getMarkdownFiles().filter((file) => {
    if (source.folder && !file.path.startsWith(`${source.folder}/`)) return false;
    return !excludes.some((excluded) => file.path === excluded || file.path.startsWith(`${excluded}/`));
  });

  const entries: DiaryEntry[] = [];
  const BATCH_SIZE = 25;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const built = await Promise.all(batch.map((file) => buildEntry(app, settings, file)));
    for (const entry of built) if (entry) entries.push(entry);
  }

  entries.sort((a, b) =>
    a.dateKey === b.dateKey
      ? a.file.basename.localeCompare(b.file.basename, "zh-CN")
      : a.dateKey.localeCompare(b.dateKey),
  );
  return entries;
}

/** 把多篇日记按「一天」聚合成时间线上的一个节点。 */
export function groupDays(entries: DiaryEntry[], order: "asc" | "desc"): DiaryDay[] {
  const map = new Map<string, DiaryDay>();
  for (const entry of entries) {
    let day = map.get(entry.dateKey);
    if (!day) {
      day = {
        dateKey: entry.dateKey,
        date: entry.date,
        entries: [],
        images: [],
        tags: [],
        charCount: 0,
      };
      map.set(entry.dateKey, day);
    }
    day.entries.push(entry);
    day.charCount += entry.charCount;
    day.images.push(...entry.images);
    for (const tag of entry.tags) if (!day.tags.includes(tag)) day.tags.push(tag);
  }
  const days = Array.from(map.values());
  days.sort((a, b) => (order === "desc" ? b.dateKey.localeCompare(a.dateKey) : a.dateKey.localeCompare(b.dateKey)));
  for (const day of days) day.entries.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  return days;
}

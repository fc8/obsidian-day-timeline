import { setIcon } from "obsidian";
import type { App } from "obsidian";

export const WEEKDAYS_SHORT = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const WEEKDAYS_LONG = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
export const MONTH_NAMES = [
  "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月",
];

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** 从任意值（字符串 / 数字 / Date / moment 对象）中解析出日期。 */
export function parseDateLike(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isValidDate(value) ? value : null;
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return isValidDate(d) ? d : null;
  }
  if (typeof value === "string") return parseDateInName(value);
  if (typeof value === "object") {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      const d = maybe.toDate();
      if (isValidDate(d)) return d;
    }
  }
  return null;
}

/** 识别 2026-11-07 / 2026.11.7 / 2026年11月7日 / 20261107 等常见日记文件名。 */
export function parseDateInName(text: string): Date | null {
  const match = /(?:^|\D)(\d{4})[-_./年\s]*(\d{1,2})[-_./月\s]*(\d{1,2})(?:日)?(?:\D|$)/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** 轻量 moment 风格格式化，够覆盖日记文件名与模板。 */
export function formatDate(date: Date, pattern: string): string {
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: pad2(date.getFullYear() % 100),
    MMMM: MONTH_NAMES[date.getMonth()],
    MMM: `${date.getMonth() + 1}月`,
    MM: pad2(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad2(date.getDate()),
    D: String(date.getDate()),
    dddd: WEEKDAYS_LONG[date.getDay()],
    ddd: WEEKDAYS_SHORT[date.getDay()],
    HH: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
    ss: pad2(date.getSeconds()),
  };
  return pattern.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|mm|ss/g, (token) => tokens[token] ?? token);
}

/** 新建日记时使用的模板：{{date}} / {{date:格式}} / \n 换行。 */
export function renderNoteTemplate(template: string, date: Date): string {
  const rendered = template
    .replace(/\{\{date:([^}]+)\}\}/g, (_all, pattern: string) => formatDate(date, pattern))
    .replace(/\{\{date\}\}/g, toDateKey(date))
    .replace(/\\n/g, "\n");
  return rendered;
}

export function isSameMonthDay(a: Date, b: Date): boolean {
  return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 今天 / 昨天 / 前天 / 星期几 / 完整日期 */
export function friendlyDayLabel(date: Date, now = new Date()): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(date)) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff === 2) return "前天";
  if (diff === -1) return "明天";
  if (Math.abs(diff) < 7) return WEEKDAYS_SHORT[date.getDay()];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function fullDateLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAYS_LONG[date.getDay()]}`;
}

/** 读取核心插件「日记」的配置（不同版本结构略有差异，全部做容错）。 */
export function resolveDailyNotesOptions(app: App): { folder?: string; format?: string } {
  try {
    const internal = (app as unknown as {
      internalPlugins?: { getPluginById?: (id: string) => unknown };
    }).internalPlugins;
    const plugin = internal?.getPluginById?.("daily-notes") as {
      instance?: { options?: Record<string, unknown> };
      options?: Record<string, unknown>;
    } | undefined;
    const options = plugin?.instance?.options ?? plugin?.options;
    if (!options) return {};
    const folder = typeof options.folder === "string" ? options.folder : "";
    const format = typeof options.format === "string" ? options.format : "";
    return {
      folder: folder && folder !== "/" ? folder.replace(/^\/+|\/+$/g, "") : undefined,
      format: format || undefined,
    };
  } catch {
    return {};
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function empty(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function iconButton(
  className: string,
  icon: string,
  label: string,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = el("button", className);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  setIcon(button, icon);
  button.addEventListener("click", onClick);
  return button;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, wait: number): (...args: Parameters<T>) => void {
  let timer: number | null = null;
  return (...args: Parameters<T>) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}

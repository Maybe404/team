// 排版自动适配：Agent 写 Markdown 时没法指定表格列宽和图片宽度，这里按内容替它定一个“适中”的值。
// 正文栏按 725px 算（网页实测值）。编辑器的图片宽度按像素工作，百分比写进去网页上不生效，所以图片宽度一律输出像素。纯函数，方便测试。

export const COLUMN_PX = 725;

/** 把 "70%" 折成像素（占正文栏的比例）；已经是像素或纯数字的原样返回成 "Npx" */
export function widthToPx(w: string): string {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(%|px)?\s*$/.exec(w);
  if (!m) return w;
  const n = Number(m[1]);
  if (m[2] === "%") return `${Math.round((Math.min(100, Math.max(5, n)) / 100) * COLUMN_PX)}px`;
  return `${Math.round(n)}px`;
}

/** 一段文字在表格里的视觉宽度（汉字按 2 算，其余按 1 算） */
const visual = (s: string) => Array.from(s).reduce((n, c) => n + (/[ -~]/.test(c) ? 1 : 2), 0);

/** 给每个 HTML 表格的单元格补上列宽：按每列最长内容估算，总宽压在正文栏以内，太窄的表适当拉宽。 */
export function sizeTables(html: string): string {
  return html.replace(/<table>[\s\S]*?<\/table>/g, (table) => {
    const rows = table.match(/<tr>[\s\S]*?<\/tr>/g);
    if (!rows) return table;
    const cells = rows.map((r) => [...r.matchAll(/<(th|td)([^>]*)>([\s\S]*?)<\/\1>/g)]);
    const cols = Math.max(...cells.map((c) => c.length));
    if (!cols) return table;
    // 每列：最长一行内容（单元格内换行按最长一行算），换成像素并限制在 [90, 360]
    let widths = Array.from({ length: cols }, (_, i) => {
      const longest = Math.max(
        ...cells.map((r) => {
          const text = (r[i]?.[3] ?? "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]*>/g, "").replace(/&[a-z#0-9]+;/g, " ");
          return Math.max(...text.split("\n").map(visual), 0);
        })
      );
      return Math.min(360, Math.max(90, longest * 7.5 + 28));
    });
    const sum = widths.reduce((a, b) => a + b, 0);
    const target = sum > COLUMN_PX ? COLUMN_PX : sum < 480 ? 480 : sum;
    widths = widths.map((w) => Math.max(80, Math.round((w / sum) * target)));
    let r = -1;
    return table.replace(/<tr>[\s\S]*?<\/tr>/g, (row) => {
      r++;
      let c = -1;
      return row.replace(/<(th|td)([^>]*)>/g, (_m, tag: string, attrs: string) => {
        c++;
        return `<${tag}${attrs} colwidth="${widths[c] ?? 120}">`;
      });
    });
  });
}

/** 读位图头里的像素尺寸（PNG、JPEG、GIF、WebP）和 SVG 的 viewBox，读不出来返回 undefined。 */
export function imageSize(type: string, data: Buffer): { w: number; h: number } | undefined {
  try {
    if (type === "image/png") return { w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
    if (type === "image/gif") return { w: data.readUInt16LE(6), h: data.readUInt16LE(8) };
    if (type === "image/webp") {
      const k = data.toString("ascii", 12, 16);
      if (k === "VP8X") return { w: 1 + data.readUIntLE(24, 3), h: 1 + data.readUIntLE(27, 3) };
      if (k === "VP8L") {
        const b = data.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
      if (k === "VP8 ") return { w: data.readUInt16LE(26) & 0x3fff, h: data.readUInt16LE(28) & 0x3fff };
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < data.length) {
        if (data[i] !== 0xff) { i++; continue; }
        const m = data[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: data.readUInt16BE(i + 5), w: data.readUInt16BE(i + 7) };
        i += 2 + data.readUInt16BE(i + 2);
      }
    }
    if (type === "image/svg+xml") {
      const s = data.toString("utf8", 0, Math.min(data.length, 2000));
      const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
      if (vb) return { w: Number(vb[1]), h: Number(vb[2]) };
      const w = /<svg[^>]*\swidth="([\d.]+)(?:px)?"/.exec(s)?.[1];
      const h = /<svg[^>]*\sheight="([\d.]+)(?:px)?"/.exec(s)?.[1];
      if (w && h) return { w: Number(w), h: Number(h) };
    }
  } catch {
    /* 读不出来就走默认值 */
  }
  return undefined;
}

/**
 * 图片显示宽度（像素，按占正文栏的比例折算）：原图宽度折成正文栏的占比，夹在 [45%, 100%]；
 * 很宽的图（接近或超过一栏）用 100%，很扁的长图（宽高比大于 3）也用 100%；读不出尺寸时用 70%。
 * SVG 没有固有像素，按 viewBox 宽度折算后再统一放大到至少 70%。
 */
export function autoImageWidth(type: string, data: Buffer): string {
  const s = imageSize(type, data);
  if (!s || !s.w || !s.h) return widthToPx("70%");
  if (s.w / s.h > 3) return widthToPx("100%");
  let pct = (s.w / COLUMN_PX) * 100;
  if (type === "image/svg+xml") pct = Math.max(70, pct);
  return widthToPx(`${Math.round(Math.min(100, Math.max(45, pct)) / 5) * 5}%`);
}

/** 写入提示用：Markdown 里有没有太宽的表格（列数过多）。 */
export function wideTables(md: string): number {
  let n = 0;
  for (const line of md.split("\n")) if (/^\s*\|\s*:?-+/.test(line) && (line.match(/\|/g)?.length ?? 0) - 1 > 7) n++;
  return n;
}

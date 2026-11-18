/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 版本对比：把两份正文拆成「块」（段落、标题、列表项、表格行……），按块做差异对比。
// 文档版本和工作项描述版本共用。
import { useMemo } from "react";
import { useTranslation } from "@plane/i18n";

export type TDiffRow = { kind: "same" | "add" | "del"; text: string };

const BLOCK_PREFIX: Record<string, string> = { H1: "# ", H2: "## ", H3: "### ", H4: "#### ", LI: "• ", BLOCKQUOTE: "> " };

export const htmlToBlocks = (html: string | undefined | null): string[] => {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  const walk = (el: Element) => {
    const tag = el.tagName;
    if (tag === "UL" || tag === "OL" || tag === "DIV" || tag === "TBODY" || tag === "THEAD" || tag === "TABLE") {
      Array.from(el.children).forEach(walk);
      return;
    }
    if (tag === "TR") {
      const cells = Array.from(el.children).map((c) => (c.textContent ?? "").trim());
      if (cells.some(Boolean)) out.push(cells.join(" | "));
      return;
    }
    if (tag === "IMG") {
      out.push(`[图片 ${el.getAttribute("src") ?? ""}]`);
      return;
    }
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const hasImg = el.querySelector("img");
    if (text) out.push((BLOCK_PREFIX[tag] ?? "") + text);
    else if (hasImg) out.push(`[图片 ${hasImg.getAttribute("src") ?? ""}]`);
  };
  Array.from(doc.body.children).forEach(walk);
  return out;
};

/** 最长公共子序列，按块比较；块数很多时退化为整体替换，避免卡页面 */
export const diffBlocks = (a: string[], b: string[]): TDiffRow[] => {
  if (a.length * b.length > 4_000_000) {
    return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
  }
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows: TDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ kind: "del", text: a[i++] });
    } else {
      rows.push({ kind: "add", text: b[j++] });
    }
  }
  while (i < n) rows.push({ kind: "del", text: a[i++] });
  while (j < m) rows.push({ kind: "add", text: b[j++] });
  return rows;
};

type Props = { oldHtml: string | undefined; newHtml: string | undefined };

const CONTEXT = 2;

export function VersionDiff({ oldHtml, newHtml }: Props) {
  const { t } = useTranslation();
  const rows = useMemo(() => diffBlocks(htmlToBlocks(oldHtml), htmlToBlocks(newHtml)), [oldHtml, newHtml]);
  const changed = rows.filter((r) => r.kind !== "same").length;
  // 只保留改动前后各 CONTEXT 行，其余折叠
  const shown = useMemo(() => {
    const keep = new Array<boolean>(rows.length).fill(false);
    rows.forEach((r, idx) => {
      if (r.kind === "same") return;
      for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(rows.length - 1, idx + CONTEXT); k++) keep[k] = true;
    });
    const out: (TDiffRow | { kind: "fold"; count: number })[] = [];
    let skipped = 0;
    rows.forEach((r, idx) => {
      if (keep[idx]) {
        if (skipped) out.push({ kind: "fold", count: skipped });
        skipped = 0;
        out.push(r);
      } else skipped++;
    });
    if (skipped) out.push({ kind: "fold", count: skipped });
    return out;
  }, [rows]);

  if (!changed) return <p className="px-5 py-6 text-body-sm-regular text-secondary">{t("loom.diff.no_change")}</p>;
  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <p className="text-caption-md-regular text-secondary">{t("loom.diff.legend")}</p>
      <ul className="flex flex-col gap-0.5 font-mono text-caption-md-regular">
        {shown.map((r, idx) =>
          r.kind === "fold" ? (
            <li key={idx} className="px-2 py-0.5 text-tertiary">
              {t("loom.diff.folded", { count: r.count })}
            </li>
          ) : (
            <li
              key={idx}
              className={
                r.kind === "add"
                  ? "rounded bg-green-500/15 px-2 py-0.5 text-primary"
                  : r.kind === "del"
                    ? "rounded bg-red-500/15 px-2 py-0.5 text-primary line-through decoration-red-500/60"
                    : "px-2 py-0.5 text-secondary"
              }
            >
              <span className="mr-2 select-none text-tertiary">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}</span>
              <span className="break-words whitespace-pre-wrap">{r.text}</span>
            </li>
          )
        )}
      </ul>
    </div>
  );
}

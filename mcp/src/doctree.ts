/** 文档列表按层级显示：子文档缩进在父文档下面；父文档不在结果里（比如被搜索过滤掉）的当作顶层。 */
export type DocRow = { id: string; name: string; updated_at: string; parent_id: string | null };

export function formatDocTree(pages: DocRow[]): string {
  const ids = new Set(pages.map((p) => p.id));
  const kids = new Map<string, DocRow[]>();
  const roots: DocRow[] = [];
  for (const p of pages) {
    if (p.parent_id && p.parent_id !== p.id && ids.has(p.parent_id)) kids.set(p.parent_id, [...(kids.get(p.parent_id) ?? []), p]);
    else roots.push(p);
  }
  const lines: string[] = [];
  const seen = new Set<string>();
  const walk = (p: DocRow, depth: number) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    const n = kids.get(p.id)?.length ?? 0;
    lines.push(`${"  ".repeat(depth)}- ${p.id}　${p.name || "无标题"}（更新于 ${p.updated_at.slice(0, 10)}${n ? `，${n} 个子页面` : ""}）`);
    (kids.get(p.id) ?? []).forEach((c) => walk(c, depth + 1));
  };
  roots.forEach((r) => walk(r, 0));
  return lines.join("\n");
}

import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

// 粘贴，或拖放（Mac 上按住 Option 拖动六点手柄是复制）。拖动移动不受影响：原块在同一次事务里被删掉，不会重号
const isCopyLike = (t: Transaction) => !!t.getMeta("paste") || t.getMeta("uiEvent") === "paste" || t.getMeta("uiEvent") === "drop";

const rand = () => Math.random().toString(36).slice(2, 10);

/**
 * 粘贴原型：粘贴进来的完整原型块如果和文档里别处的块编号相同，换一个新编号，
 * 同批粘贴进来、引用它的局部块一起改引用；否则从副本拆出的局部会指向原件。
 */
export function dedupeEmbedUids(trs: readonly Transaction[], state: EditorState, typeName: string): Transaction | null {
          if (!trs.some((t) => isCopyLike(t))) return null;
          // 粘贴插入的范围（映射到最新文档）
          const ranges: [number, number][] = [];
          for (const tr of trs) {
            if (!isCopyLike(tr)) continue;
            tr.steps.forEach((step, i) => {
              step.getMap().forEach((_os, _oe, ns, ne) => {
                const rest = tr.mapping.slice(i + 1);
                ranges.push([rest.map(ns, -1), rest.map(ne, 1)]);
              });
            });
          }
          if (!ranges.length) return null;
          const inside = (pos: number) => ranges.some(([a, b]) => pos >= a && pos < b);
          const outsideUids = new Set<string>();
          const pastedSources: { pos: number; node: PMNode }[] = [];
          const pastedPartials: { pos: number; node: PMNode }[] = [];
          state.doc.descendants((n, pos) => {
            if (n.type.name !== typeName) return true;
            const isSource = !!n.attrs.html && !!n.attrs.uid;
            if (inside(pos)) {
              if (isSource) pastedSources.push({ pos, node: n });
              else if (n.attrs.ref) pastedPartials.push({ pos, node: n });
            } else if (isSource) outsideUids.add(n.attrs.uid as string);
            return true;
          });
          const remap = new Map<string, string>();
          for (const { node } of pastedSources) {
            const uid = node.attrs.uid as string;
            if (outsideUids.has(uid) && !remap.has(uid)) remap.set(uid, rand());
          }
          if (!remap.size) return null;
          const tr2 = state.tr;
          for (const { pos, node } of pastedSources) {
            const next = remap.get(node.attrs.uid as string);
            if (next) tr2.setNodeMarkup(pos, undefined, { ...node.attrs, uid: next });
          }
          for (const { pos, node } of pastedPartials) {
            const next = remap.get(node.attrs.ref as string);
            if (next) tr2.setNodeMarkup(pos, undefined, { ...node.attrs, ref: next });
          }
          return tr2.docChanged ? tr2 : null;
        }

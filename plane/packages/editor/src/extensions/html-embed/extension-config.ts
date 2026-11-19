/**
 * [team 二开] HTML 嵌入块：把一整页 HTML 放进文档，在沙箱 iframe 里独立渲染。
 * 内容直接存在节点属性里（不走附件上传），这样 Agent 通过 MCP 也能写入，公开分享页也能渲染。
 */
import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

export const HTML_EMBED_TAG = "html-embed-component";
export const HTML_EMBED_MAX_BYTES = 2 * 1024 * 1024;
export const HTML_EMBED_DEFAULT_HEIGHT = 420;

export type THtmlEmbedAttributes = {
  html: string;
  name: string;
  /** 像素高度 */
  height: number;
  /** 占正文宽度的百分比 */
  width: number;
  /** 只讲原型里的某一块：元素的 CSS 选择器，空表示展示整页 */
  focus: string;
  /** crop：只露出这一块（其余裁掉）；spot：整页都在，其余压暗 */
  mode: "crop" | "spot";
  /** 把这个元素附近弹出的下拉、浮层也算进展示范围 */
  follow: boolean;
  /** spot 模式下压暗的区域不响应点击 */
  lock: boolean;
  /** 复用同一篇文档里另一个 HTML 块的内容（先按 uid，没有再按名称），这样原型只存一份，改一处全部生效 */
  ref: string;
  /** 完整原型块的固定编号：文件名重复、替换文件改了名，局部块也不会引用错 */
  uid: string;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [CORE_EXTENSIONS.HTML_EMBED]: {
      insertHtmlEmbed: (attrs?: Partial<THtmlEmbedAttributes>) => ReturnType;
    };
  }
}

const flag = (value: string | null, fallback: boolean) => (value === null ? fallback : value !== "false");

const num = (value: string | null, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const HtmlEmbedExtensionConfig = Node.create({
  name: CORE_EXTENSIONS.HTML_EMBED,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      html: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-html") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => ({ "data-html": attrs.html as string }),
      },
      name: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-name") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => ({ "data-name": attrs.name as string }),
      },
      height: {
        default: HTML_EMBED_DEFAULT_HEIGHT,
        parseHTML: (el: HTMLElement) => num(el.getAttribute("data-height"), HTML_EMBED_DEFAULT_HEIGHT),
        renderHTML: (attrs: Record<string, unknown>) => ({ "data-height": String(attrs.height) }),
      },
      width: {
        default: 100,
        parseHTML: (el: HTMLElement) => num(el.getAttribute("data-width"), 100),
        renderHTML: (attrs: Record<string, unknown>) => ({ "data-width": String(attrs.width) }),
      },
      focus: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-focus") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => (attrs.focus ? { "data-focus": attrs.focus as string } : {}),
      },
      mode: {
        default: "crop",
        parseHTML: (el: HTMLElement) => (el.getAttribute("data-mode") === "spot" ? "spot" : "crop"),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.mode === "spot" ? { "data-mode": "spot" } : {}),
      },
      follow: {
        default: true,
        parseHTML: (el: HTMLElement) => flag(el.getAttribute("data-follow"), true),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.follow === false ? { "data-follow": "false" } : {}),
      },
      lock: {
        default: true,
        parseHTML: (el: HTMLElement) => flag(el.getAttribute("data-lock"), true),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.lock === false ? { "data-lock": "false" } : {}),
      },
      uid: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-uid") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => (attrs.uid ? { "data-uid": attrs.uid as string } : {}),
      },
      ref: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-ref") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => (attrs.ref ? { "data-ref": attrs.ref as string } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: HTML_EMBED_TAG }];
  },

  renderHTML({ HTMLAttributes }) {
    return [HTML_EMBED_TAG, mergeAttributes(HTMLAttributes)];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const info = [
            node.attrs.name ? ` name=${JSON.stringify(String(node.attrs.name))}` : "",
            node.attrs.focus ? ` focus=${JSON.stringify(String(node.attrs.focus))}` : "",
            node.attrs.focus && node.attrs.mode === "spot" ? " mode=spot" : "",
            node.attrs.uid ? ` id=${JSON.stringify(String(node.attrs.uid))}` : "",
            node.attrs.ref ? ` ref=${JSON.stringify(String(node.attrs.ref))}` : "",
          ].join("");
          state.write(`\`\`\`html-embed${info}\n`);
          state.text(String(node.attrs.html ?? ""), false);
          state.ensureNewLine();
          state.write("```");
          state.closeBlock(node);
        },
      },
    };
  },
});

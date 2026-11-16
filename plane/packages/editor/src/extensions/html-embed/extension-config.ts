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
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [CORE_EXTENSIONS.HTML_EMBED]: {
      insertHtmlEmbed: (attrs?: Partial<THtmlEmbedAttributes>) => ReturnType;
    };
  }
}

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
          state.write("```html-embed\n");
          state.text(String(node.attrs.html ?? ""), false);
          state.ensureNewLine();
          state.write("```");
          state.closeBlock(node);
        },
      },
    };
  },
});

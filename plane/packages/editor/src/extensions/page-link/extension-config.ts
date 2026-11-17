/**
 * [team 二开] 页面链接卡片：文档里的「子页面」和页面引用。
 * 节点只存 页面 ID、项目 ID 和标题（标题只是兜底，打开时会取最新的），点击跳转到那篇文档。
 */
import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";

export const PAGE_LINK_TAG = "page-link-component";

export type TPageLinkAttributes = {
  pageId: string;
  projectId: string;
  title: string;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [CORE_EXTENSIONS.PAGE_LINK]: {
      insertPageLink: (attrs?: Partial<TPageLinkAttributes>) => ReturnType;
    };
  }
}

export const PageLinkExtensionConfig = Node.create({
  name: CORE_EXTENSIONS.PAGE_LINK,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-page-id") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => ({ "data-page-id": attrs.pageId as string }),
      },
      projectId: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-project-id") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => ({ "data-project-id": attrs.projectId as string }),
      },
      title: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-title") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => ({ "data-title": attrs.title as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: PAGE_LINK_TAG }];
  },

  renderHTML({ HTMLAttributes }) {
    return [PAGE_LINK_TAG, mergeAttributes(HTMLAttributes)];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          state.write(`[📄 ${String(node.attrs.title ?? "").replace(/[[\]]/g, "") || "页面"}](page:${String(node.attrs.pageId ?? "")})`);
          state.closeBlock(node);
        },
      },
    };
  },
});

import { ReactNodeViewRenderer } from "@tiptap/react";
import { insertEmptyParagraphAtNodeBoundaries } from "@/helpers/insert-empty-paragraph-at-node-boundary";
import { PageLinkBlock } from "./block";
import { PageLinkExtensionConfig } from "./extension-config";

export const PageLinkExtension = PageLinkExtensionConfig.extend({
  addCommands() {
    return {
      insertPageLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
  addKeyboardShortcuts() {
    return {
      ArrowDown: insertEmptyParagraphAtNodeBoundaries("down", this.name),
      ArrowUp: insertEmptyParagraphAtNodeBoundaries("up", this.name),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageLinkBlock);
  },
});

import { ReactNodeViewRenderer } from "@tiptap/react";
import { insertEmptyParagraphAtNodeBoundaries } from "@/helpers/insert-empty-paragraph-at-node-boundary";
import { HtmlEmbedBlock } from "./block";
import { HtmlEmbedExtensionConfig } from "./extension-config";

export const HtmlEmbedExtension = HtmlEmbedExtensionConfig.extend({
  addCommands() {
    return {
      insertHtmlEmbed:
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
    return ReactNodeViewRenderer(HtmlEmbedBlock);
  },
});

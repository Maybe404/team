import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { insertEmptyParagraphAtNodeBoundaries } from "@/helpers/insert-empty-paragraph-at-node-boundary";
import { HtmlEmbedBlock } from "./block";
import { dedupeEmbedUids } from "./dedupe-uid";
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
  addProseMirrorPlugins() {
    const typeName = this.name;
    return [
      new Plugin({
        key: new PluginKey("htmlEmbedUid"),
        appendTransaction: (trs, _old, state) => dedupeEmbedUids(trs, state, typeName),
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(HtmlEmbedBlock);
  },
});

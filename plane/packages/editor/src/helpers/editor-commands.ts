/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { navigateApp } from "./navigate-app";
import type { Editor, Range } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// extensions
import { replaceCodeWithText } from "@/extensions/code/utils/replace-code-block-with-text";
import type { InsertImageComponentProps } from "@/extensions/custom-image/types";
// helpers
import type { ExtendedEmojiStorage } from "@/extensions/emoji/emoji";
import { findTableAncestor } from "@/helpers/common";

export const setText = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).setNode(CORE_EXTENSIONS.PARAGRAPH).run();
  else editor.chain().focus().setNode(CORE_EXTENSIONS.PARAGRAPH).run();
};

export const toggleHeading = (editor: Editor, level: 1 | 2 | 3 | 4 | 5 | 6, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).setNode(CORE_EXTENSIONS.HEADING, { level }).run();
  else editor.chain().focus().toggleHeading({ level }).run();
};

export const toggleBold = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleBold().run();
  else editor.chain().focus().toggleBold().run();
};

export const toggleItalic = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleItalic().run();
  else editor.chain().focus().toggleItalic().run();
};

export const toggleUnderline = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleUnderline().run();
  else editor.chain().focus().toggleUnderline().run();
};

export const toggleCodeBlock = (editor: Editor, range?: Range) => {
  try {
    // if it's a code block, replace it with the code with paragraphs
    if (editor.isActive(CORE_EXTENSIONS.CODE_BLOCK)) {
      replaceCodeWithText(editor);
      return;
    }

    const { from, to } = range || editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");
    const isMultiline = text.includes("\n");

    // if the selection is not a range i.e. empty, then simply convert it into a codeBlock
    if (editor.state.selection.empty) {
      editor.chain().focus().toggleCodeBlock().run();
    } else if (isMultiline) {
      // if the selection is multiline, then also replace the text content with
      // a codeBlock
      editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, `\`\`\`\n${text}\n\`\`\``).run();
    } else {
      // if the selection is single line, then simply convert it into inline
      // code
      editor.chain().focus().toggleCode().run();
    }
  } catch (error) {
    console.error("An error occurred while toggling code block:", error);
  }
};

export const toggleOrderedList = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleOrderedList().run();
  else editor.chain().focus().toggleOrderedList().run();
};

export const toggleBulletList = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleBulletList().run();
  else editor.chain().focus().toggleBulletList().run();
};

export const toggleTaskList = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleTaskList().run();
  else editor.chain().focus().toggleTaskList().run();
};

export const toggleStrike = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleStrike().run();
  else editor.chain().focus().toggleStrike().run();
};

export const toggleBlockquote = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).toggleBlockquote().run();
  else editor.chain().focus().toggleBlockquote().run();
};

export const insertTableCommand = (editor: Editor, range?: Range) => {
  if (typeof window !== "undefined") {
    const selection = window.getSelection();
    if (selection) {
      if (selection.rangeCount !== 0) {
        const range = selection.getRangeAt(0);
        if (findTableAncestor(range.startContainer)) {
          return;
        }
      }
    }
  }
  if (range) editor.chain().focus().deleteRange(range).clearNodes().insertTable({ rows: 3, cols: 3 }).run();
  else editor.chain().focus().clearNodes().insertTable({ rows: 3, cols: 3 }).run();
};

export const insertImage = ({
  editor,
  event,
  pos,
  file,
  range,
}: {
  editor: Editor;
  event: "insert" | "drop";
  pos?: number | null;
  file?: File;
  range?: Range;
}) => {
  if (range) editor.chain().focus().deleteRange(range).run();

  const imageOptions: InsertImageComponentProps = { event };
  if (pos) imageOptions.pos = pos;
  if (file) imageOptions.file = file;
  return editor?.chain().focus().insertImageComponent(imageOptions).run();
};

export const unsetLinkEditor = (editor: Editor) => {
  editor.chain().focus().unsetLink().run();
};

export const setLinkEditor = (editor: Editor, url: string, text?: string) => {
  const { selection } = editor.state;
  const previousSelection = { from: selection.from, to: selection.to };
  if (text) {
    editor
      .chain()
      .focus()
      .deleteRange({ from: selection.from, to: selection.to })
      .insertContentAt(previousSelection.from, text)
      .run();
    // Extracting the new selection start point.
    const previousFrom = previousSelection.from;

    editor.commands.setTextSelection({ from: previousFrom, to: previousFrom + text.length });
  }
  editor.chain().focus().setLink({ href: url }).run();
};

export const toggleTextColor = (color: string | undefined, editor: Editor, range?: Range) => {
  if (color) {
    if (range) editor.chain().focus().deleteRange(range).setTextColor(color).run();
    else editor.chain().focus().setTextColor(color).run();
  } else {
    if (range) editor.chain().focus().deleteRange(range).unsetTextColor().run();
    else editor.chain().focus().unsetTextColor().run();
  }
};

export const toggleBackgroundColor = (color: string | undefined, editor: Editor, range?: Range) => {
  if (color) {
    if (range) {
      editor.chain().focus().deleteRange(range).setBackgroundColor(color).run();
    } else {
      editor.chain().focus().setBackgroundColor(color).run();
    }
  } else {
    if (range) {
      editor.chain().focus().deleteRange(range).unsetBackgroundColor().run();
    } else {
      editor.chain().focus().unsetBackgroundColor().run();
    }
  }
};

export const setTextAlign = (alignment: string, editor: Editor) => {
  editor.chain().focus().setTextAlign(alignment).run();
};

export const insertHorizontalRule = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).setHorizontalRule().run();
  else editor.chain().focus().setHorizontalRule().run();
};

export const insertHtmlEmbed = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).insertHtmlEmbed().run();
  else editor.chain().focus().insertHtmlEmbed().run();
};

// [team 二开] 斜杠「子页面」：直接在当前页面下新建一个子页面，放一张卡片，然后跳转过去编辑。
export const insertSubpage = (editor: Editor, range?: Range) => {
  const m = window.location.pathname.match(/^\/([^/]+)\/projects\/([^/]+)\/pages\/([^/?#]+)/);
  if (range) editor.chain().focus().deleteRange(range).run();
  if (!m) {
    alert("只能在项目的页面里新建子页面。");
    return;
  }
  const [, slug, projectId, pageId] = m;
  // 盖一层「正在创建」遮罩，避免用户看到父页面里先冒出一个块再跳转，以为卡住了
  const cover = document.createElement("div");
  cover.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.85);font-size:14px;color:#555";
  cover.textContent = "正在创建子页面…";
  document.body.appendChild(cover);
  void fetch(`/api/workspaces/${slug}/projects/${projectId}/pages/`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ name: "", parent: pageId }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { id: string };
      editor.chain().focus().insertPageLink({ pageId: page.id, projectId, title: "无标题" }).run();
      // 留一点时间让刚插入的卡片同步保存，再跳到新页面
      window.setTimeout(() => {
        navigateApp(`/${slug}/projects/${projectId}/pages/${page.id}`);
        // 路由跳转不会整页刷新，遮罩要自己撤掉
        window.setTimeout(() => cover.remove(), 600);
      }, 700);
    })
    .catch(() => {
      cover.remove();
      alert("没能新建子页面，请稍后再试。");
    });
};

export const insertCallout = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).insertCallout().run();
  else editor.chain().focus().insertCallout().run();
};

export const openEmojiPicker = (editor: Editor, range?: Range) => {
  if (range) editor.chain().focus().deleteRange(range).run();
  const emojiStorage = editor.storage.emoji as ExtendedEmojiStorage;
  emojiStorage.forceOpen = true;
  editor.chain().focus().insertContent(":").run();
};

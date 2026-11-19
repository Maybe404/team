/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Handle } from "hast-util-to-mdast";
// local imports
import { createTextNode } from "./common";
import type { TCustomComponentsMetaData } from "./types";

type TArgs = {
  metaData: TCustomComponentsMetaData;
};

export const parseCustomComponents = (args: TArgs): Record<string, Handle> => {
  const { metaData } = args;

  const getFileAssetDetails = (id: string) => metaData.file_assets.find((asset) => asset.id === id);

  return {
    "image-component": (_state, node) => {
      const properties = node.properties || {};
      const src = String(properties.src);
      const fileAssetDetails = getFileAssetDetails(src);
      if (!src || !fileAssetDetails) return createTextNode("");
      return createTextNode(`![${fileAssetDetails.name}](${fileAssetDetails.url})`);
    },
    img: (_state, node) => {
      const properties = node.properties || {};
      const src = String(properties.src);
      const alt = String(properties.alt);
      if (!src || !alt) return createTextNode("");
      return createTextNode(`![${alt || "Image"}](${src})`);
    },
    // [team 二开] HTML 嵌入块：导出成和 MCP 兼容的 html-embed 围栏（完整原型保留内容，局部块留空，带 id、ref、focus 等）
    "html-embed-component": (_state, node) => {
      const p = (node.properties || {}) as Record<string, unknown>;
      const str = (key: string) => (p[key] === undefined || p[key] === null ? "" : String(p[key]));
      const html = str("dataHtml");
      const q = (v: string) => JSON.stringify(v);
      const name = str("dataName").replace(/"/g, "'");
      const focus = str("dataFocus");
      const extra = [
        str("dataUid") ? ` id=${q(str("dataUid"))}` : "",
        focus && str("dataCw") ? ` cw=${str("dataCw")}` : "",
        focus ? ` focus=${q(focus)}` : "",
        focus && str("dataMode") === "spot" ? " mode=spot" : "",
        focus && str("dataFollow") === "false" ? " follow=false" : "",
        focus && str("dataLock") === "false" ? " lock=false" : "",
        str("dataRef") ? ` ref=${q(str("dataRef"))}` : "",
      ].join("");
      const fence = "`".repeat(Math.max(3, ...(html.match(/`+/g) ?? []).map((m) => m.length + 1)));
      return createTextNode(`\n\n${fence}html-embed name="${name}" height=${str("dataHeight") || 420} width=${str("dataWidth") || 100}${extra}\n${html ? `${html}\n` : ""}${fence}\n\n`);
    },
    "mention-component": (_state, node) => {
      const properties = node.properties || {};
      const mentionType = String(properties.entity_name);

      let url: string = "";
      let tag: string = "@";
      if (mentionType === "user_mention") {
        const userId = String(properties.entity_identifier);
        const userDetails = metaData.user_mentions.find((user) => user.id === userId);
        if (!userDetails) return createTextNode("");
        url = userDetails.url || "";
        tag = `@${userDetails.display_name || "Unknown user"}`;
      }

      return createTextNode(`[${tag}](${url}) `);
    },
  };
};

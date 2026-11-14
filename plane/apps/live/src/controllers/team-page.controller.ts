/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
// [team 二开] 供 API 服务调用：把 Agent 写入的 HTML 以增量 Yjs 编辑的方式合进 Page。
// - 文档正在被人打开（在本实例内存里）：直接改内存里的文档，在线编辑器实时看到变化；
// - 没人打开：用数据库里的 binary 还原文档，改完返回新的三种格式，由 API 落库。
// 两种情况都返回新的 binary/html/json，API 一律落库，避免依赖 live 的防抖存储。
import type { Request, Response } from "express";
import * as Y from "yjs";
import { Controller, Post } from "@plane/decorators";
import {
  applyHTMLToDocumentEditorYDoc,
  getAllDocumentFormatsFromDocumentEditorBinaryData,
  getBinaryDataFromDocumentEditorHTMLString,
} from "@plane/editor/server";
import { logger } from "@plane/logger";
import { HocusPocusServerManager } from "@/hocuspocus";
import { requireSecretKey } from "@/lib/auth-middleware";

const MAX_BODY_BYTES = 20 * 1024 * 1024;

type TApplyBody = {
  page_id: string;
  page_name?: string;
  description_html: string;
  // 数据库里当前的 binary（base64），没有就传空，由 current_html 还原
  current_binary?: string | null;
  current_html?: string | null;
};

const readJSONBody = async (req: Request): Promise<TApplyBody> => {
  // 全局的 express.json() 有 100kb 限制且只处理 application/json，这里用独立的 content-type 自行读取
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as TApplyBody;
};

@Controller("/team/pages")
export class TeamPageController {
  @Post("/apply-html")
  async applyHTML(req: Request, res: Response) {
    let authorized = false;
    requireSecretKey(req, res, () => {
      authorized = true;
    });
    if (!authorized) return;

    try {
      const body = await readJSONBody(req);
      if (!body.page_id || typeof body.description_html !== "string") {
        return res.status(400).json({ error: "page_id 和 description_html 必填" });
      }

      const server = HocusPocusServerManager.getInstance().getServer();
      const liveDocument = server?.documents.get(body.page_id);

      let yDoc: Y.Doc;
      if (liveDocument) {
        yDoc = liveDocument;
      } else {
        yDoc = new Y.Doc();
        const current = body.current_binary ? new Uint8Array(Buffer.from(body.current_binary, "base64")) : null;
        if (current && current.byteLength > 0) {
          Y.applyUpdate(yDoc, current);
        } else {
          Y.applyUpdate(
            yDoc,
            getBinaryDataFromDocumentEditorHTMLString(body.current_html || "<p></p>", body.page_name ?? undefined)
          );
        }
      }

      applyHTMLToDocumentEditorYDoc(yDoc, body.description_html);

      const { contentBinaryEncoded, contentHTML, contentJSON } = getAllDocumentFormatsFromDocumentEditorBinaryData(
        Y.encodeStateAsUpdate(yDoc),
        true
      );
      return res.status(200).json({
        live: Boolean(liveDocument),
        connections: liveDocument?.getConnectionsCount() ?? 0,
        description_binary: contentBinaryEncoded,
        description_html: contentHTML,
        description_json: contentJSON,
      });
    } catch (error) {
      logger.error("TEAM_PAGE_CONTROLLER: apply-html failed", error);
      return res.status(500).json({ error: "apply-html failed" });
    }
  }
}

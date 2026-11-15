/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 添加 team-mcp 的命令。MCP 是本站 /mcp/<工作区> 下的 HTTP 服务，本机不用装任何东西，
// 命令里带好本站地址、工作区和 Token，复制到终端执行一次即可；也给出在客户端界面里手动添加时要填的字段。
import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { CopyOutline } from "@makeplane/propel/icons";
import { setToast } from "@plane/blocks/toast";
import { copyTextToClipboard } from "@plane/utils";
import { useWorkspace } from "@/hooks/store/use-workspace";

type Props = { token?: string };

function CopyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-caption-sm-medium text-tertiary">{label}</div>
      <button
        type="button"
        onClick={() =>
          void copyTextToClipboard(value).then(() => setToast({ type: "success", title: "已复制", message: label }))
        }
        className="flex w-full items-start justify-between gap-2 rounded-md border-[0.5px] border-subtle bg-layer-1 px-3 py-2 text-left font-mono text-caption-sm-regular break-all whitespace-pre-wrap outline-none"
      >
        <span>{value}</span>
        <CopyOutline className="mt-0.5 h-4 w-4 flex-shrink-0 text-placeholder" />
      </button>
    </div>
  );
}

export const TeamMcpInstall = observer(function TeamMcpInstall({ token }: Props) {
  const { workspaces } = useWorkspace();
  const slugs = useMemo(() => Object.values(workspaces ?? {}).map((w) => w.slug), [workspaces]);
  const [slug, setSlug] = useState("");
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => {
    if (!slug && slugs.length) setSlug(slugs[0]);
  }, [slug, slugs]);

  const url = `${origin}/mcp/${slug}`;
  const tok = token || "<你的 Token>";
  const command = `claude mcp add --transport http team ${url} --header "Authorization: Bearer ${tok}"`;
  const json = JSON.stringify({ mcpServers: { team: { type: "http", url, headers: { Authorization: `Bearer ${tok}` } } } }, null, 2);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-1 p-4">
      <div>
        <div className="text-body-sm-medium text-primary">添加 team-mcp</div>
        <div className="text-caption-sm-regular text-tertiary">
          本机不用装任何东西。在终端执行下面这条命令，重启 Claude Code，在团队项目的仓库里让 Agent 调用
          whoami 确认。{token ? "命令里已经带上这个 Token，不要发给别人。" : "把命令里的 Token 换成你自己的。"}
        </div>
      </div>
      {slugs.length > 1 && (
        <label className="flex items-center gap-2 text-caption-sm-regular text-secondary">
          工作区
          <select
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="rounded-md border border-subtle bg-layer-1 px-2 py-1"
          >
            {slugs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}
      <CopyBlock label="Claude Code 终端命令" value={command} />
      <CopyBlock label="其他客户端（Cursor 等）的 JSON 配置，或在界面里添加 HTTP 类型的 MCP 服务，网址和请求头按这里填" value={json} />
    </div>
  );
});

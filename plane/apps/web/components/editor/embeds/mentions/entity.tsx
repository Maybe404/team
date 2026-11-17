/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 正文里 @ 出来的页面和工作项：行内小标签，点击跳转。entity_identifier 写成「项目ID/对象ID」。
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Link } from "react-router";

type Props = { kind: "page" | "issue"; identifier: string };

export function EditorEntityMention({ kind, identifier }: Props) {
  const { workspaceSlug } = useParams();
  const [projectId, id] = identifier.includes("/") ? identifier.split("/") : ["", identifier];
  const [label, setLabel] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!workspaceSlug || !projectId || !id) return;
    let cancelled = false;
    const base = `/api/workspaces/${workspaceSlug}/projects/${projectId}`;
    const url = kind === "page" ? `${base}/pages/${id}/` : `${base}/issues/${id}/`;
    void fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(async (r) => (r.ok ? ((await r.json()) as { name?: string; sequence_id?: number }) : null))
      .then((d) => {
        if (cancelled) return;
        if (!d) return setGone(true);
        setLabel(kind === "page" ? d.name?.trim() || "无标题" : `#${d.sequence_id ?? ""} ${d.name ?? ""}`.trim());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, projectId, id, kind]);

  const icon = kind === "page" ? "📄" : "✅";
  if (gone) {
    return <span className="not-prose inline rounded-sm bg-layer-1 px-1 py-0.5 text-tertiary">{icon} 无法打开</span>;
  }
  const to = `/${workspaceSlug}/projects/${projectId}/${kind === "page" ? "pages" : "issues"}/${id}`;
  return (
    <Link
      to={to}
      className="not-prose inline rounded-sm bg-accent-subtle-active px-1 py-0.5 text-accent-primary no-underline hover:underline"
    >
      {icon} {label ?? "加载中…"}
    </Link>
  );
}

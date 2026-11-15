/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 项目关联的代码仓库。team-mcp 按 Agent 当前仓库的 git remote 匹配项目，
// 只有这里登记过的仓库里，Agent 才能读写这个项目的任务和文档。只有项目管理员能改。
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import { TextAreaField } from "@makeplane/propel/components/text-area-field";
import { setToast } from "@plane/blocks/toast";
import { useProject } from "@/hooks/store/use-project";

type Props = { workspaceSlug: string; projectId: string; isAdmin: boolean };

export const TeamReposSection = observer(function TeamReposSection({ workspaceSlug, projectId, isAdmin }: Props) {
  const { getProjectById, updateProject } = useProject();
  const project = getProjectById(projectId);
  const saved = (project?.team_repos ?? []).join("\n");
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(saved), [saved]);

  const onSave = async () => {
    setSaving(true);
    const team_repos = value
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    try {
      await updateProject(workspaceSlug, projectId, { team_repos });
      setToast({ type: "success", title: "已保存", message: "关联仓库已更新" });
    } catch {
      setToast({ type: "error", title: "保存失败", message: "只有项目管理员能修改关联仓库" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-subtle pt-6">
      <div>
        <div className="text-h6-medium text-primary">关联代码仓库</div>
        <div className="text-body-sm-regular text-tertiary">
          每行一个仓库地址，例如 github.com/org/repo，https 和 git@ 写法都可以。只有在这些仓库里工作的 Agent 才能读写本项目。
        </div>
      </div>
      <TextAreaField
        size="lg"
        resize="none"
        autoResize
        maxRows={8}
        id="team_repos"
        name="team_repos"
        label="仓库地址"
        value={value}
        placeholder="github.com/org/repo"
        onChange={(e) => setValue(e.target.value)}
        disabled={!isAdmin}
      />
      {isAdmin && (
        <div>
          <Button
            variant="secondary"
            size="md"
            stretch="auto"
            label={saving ? "保存中" : "保存关联仓库"}
            loading={saving}
            disabled={value === saved}
            onClick={() => void onSave()}
          />
        </div>
      )}
    </div>
  );
});

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 更新日志：内容来自仓库根目录 CHANGELOG.md（发版时由 deploy/set-version.sh 复制到 public/changelog.md）。
// 升级后第一次打开页面自动弹一次，之后从帮助菜单底部的版本号进入。
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import packageJson from "package.json";

const SEEN_KEY = "loom-changelog-seen-version";

export function ChangelogModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || text !== null) return;
    fetch(`/changelog.md?v=${packageJson.version}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setText)
      .catch(() => setText("暂时读不到更新日志。"));
  }, [isOpen, text]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>更新日志（当前 v{packageJson.version}）</DialogTitle>
            </DialogHeading>
          </DialogHeader>
          <DialogBody>
            <div className="max-h-[60vh] overflow-y-auto pr-2 text-body-sm-regular text-secondary">
              {text === null ? (
                "加载中…"
              ) : (
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => <h1 className="mb-2 text-18 font-semibold text-primary">{children}</h1>,
                    h2: ({ children }) => <h2 className="mt-5 mb-2 text-16 font-semibold text-primary">{children}</h2>,
                    h3: ({ children }) => <h3 className="mt-4 mb-1.5 text-14 font-semibold text-primary">{children}</h3>,
                    p: ({ children }) => <p className="my-1.5 leading-6">{children}</p>,
                    ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
                    code: ({ children }) => <code className="rounded-sm bg-layer-2 px-1 text-caption-sm-regular">{children}</code>,
                  }}
                >
                  {text}
                </ReactMarkdown>
              )}
            </div>
          </DialogBody>
        </DialogMain>
        <DialogActions>
          <Button variant="secondary" size="sm" stretch="auto" label="关闭" onClick={onClose} />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** 帮助菜单里的版本号按钮；升级后第一次打开自动弹出更新日志。 */
export function useChangelog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const seen = localStorage.getItem(SEEN_KEY);
      // 没记录过或版本变了都弹一次（这一版之前没有记录，所以升级到这一版的人也会看到）
      if (seen !== packageJson.version) setOpen(true);
      localStorage.setItem(SEEN_KEY, packageJson.version);
    } catch {
      /* 浏览器禁用了本地存储就不提示 */
    }
  }, []);
  return { open, setOpen };
}

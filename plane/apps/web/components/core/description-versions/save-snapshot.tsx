/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 把当前描述保存成一个版本（可起名），和文档的「保存为版本」一致
import { useState } from "react";
import { Button } from "@makeplane/propel/components/button";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TDescriptionVersionManage } from "./root";

export function SaveSnapshotButton(props: { manage: TDescriptionVersionManage; onSaved: () => void }) {
  const { manage, onSaved } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = () => {
    setSaving(true);
    manage
      .saveSnapshot(label.trim())
      .then(() => {
        setToast({ type: "success", title: t("loom.version.saved") });
        onSaved();
        setOpen(false);
        setLabel("");
      })
      .catch(() => setToast({ type: "error", title: t("loom.version.save_failed") }))
      .finally(() => setSaving(false));
  };

  if (!open) {
    return <Button variant="ghost" size="sm" stretch="auto" onClick={() => setOpen(true)} label={t("loom.version.save_current")} />;
  }
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={label}
        maxLength={100}
        placeholder={t("loom.version.name_placeholder")}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        className="w-48 rounded-md border border-subtle bg-layer-1 px-2 py-1 text-caption-md-regular text-primary outline-none focus:border-accent-strong"
      />
      <Button variant="primary" size="sm" stretch="auto" loading={saving} onClick={submit} label={t("loom.common.save")} />
      <Button variant="ghost" size="sm" stretch="auto" onClick={() => setOpen(false)} label={t("loom.common.cancel")} />
    </div>
  );
}

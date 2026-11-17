/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// assets
import { useTranslation } from "@plane/i18n";
import packageJson from "package.json";

export function PlaneVersionNumber() {
  const { t } = useTranslation();
  return (
    // [team 二开] Loom 自己的版本号（来自仓库根目录 VERSION），上游 Plane 版本写在 title 里
    <span title="基于 Plane 1.5.0">
      Loom {t("version")}: v{packageJson.version}
    </span>
  );
}

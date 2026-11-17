/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { HelpOutline } from "@makeplane/propel/icons";
import { useTranslation } from "@plane/i18n";
// ui
import { Menu, MenuContent, MenuFooter, MenuItem, MenuTrigger } from "@makeplane/propel/components/menu";
import { Tooltip } from "@makeplane/propel/components/tooltip";
import { IconButton } from "@makeplane/propel/elements/icon-button";
// components
import { ChangelogModal, useChangelog } from "@/components/global/changelog-modal";
import { PlaneVersionNumber } from "@/components/global/version-number";
// hooks
import { usePowerK } from "@/hooks/store/use-power-k";

export const HelpMenuRoot = observer(function HelpMenuRoot() {
  // store hooks
  const { t } = useTranslation();
  const { toggleShortcutsListModal } = usePowerK();
  const changelog = useChangelog();

  return (
    <>
      <ChangelogModal isOpen={changelog.open} onClose={() => changelog.setOpen(false)} />
      <Menu>
        <Tooltip label={t("power_k.group_titles.help")} side="bottom">
          <MenuTrigger
            render={
              <IconButton
                variant="ghost"
                size="md"
                aria-label={t("power_k.group_titles.help")}
                render={<button type="button" className="data-popup-open:bg-layer-transparent-active" />}
              >
                <HelpOutline className="size-4.5" />
              </IconButton>
            }
          />
        </Tooltip>
        <MenuContent
          side="bottom"
          align="end"
          footer={
            <MenuFooter>
              <button type="button" className="cursor-pointer hover:underline" onClick={() => changelog.setOpen(true)}>
                <PlaneVersionNumber />
              </button>
            </MenuFooter>
          }
        >
          {/* [team 二开] 去掉文档、联系销售、更新日志、论坛等对外链接 */}
          <MenuItem label="更新日志" onClick={() => changelog.setOpen(true)} />
          <MenuItem label={t("keyboard_shortcuts")} onClick={() => toggleShortcutsListModal(true)} />
        </MenuContent>
      </Menu>
    </>
  );
});

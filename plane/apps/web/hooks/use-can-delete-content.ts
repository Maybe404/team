/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// [team 二开] 只有工作区管理员能删除共享内容，其他人只能归档。服务端在 plane/utils/team_delete_guard.py 里同样拦截。
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useUserPermissions } from "@/hooks/store/user";

export const useCanDeleteContent = (): boolean => {
  const { allowPermissions } = useUserPermissions();
  return allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
};

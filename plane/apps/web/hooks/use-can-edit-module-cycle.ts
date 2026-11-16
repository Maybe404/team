// [team 二开] 模块、周期的信息只有创建人（模块还有负责人）和工作区管理员能改，其他成员只能查看。
// 把任务放进/移出模块、周期不受限制。服务端在 plane/utils/team_edit_policy.py 里同样拦截。
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useUser, useUserPermissions } from "@/hooks/store/user";

export const useCanEditModule = (module?: { created_by?: string | null; lead_id?: string | null } | null): boolean => {
  const { data: currentUser } = useUser();
  const { allowPermissions } = useUserPermissions();
  if (!module) return false;
  if (allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE)) return true;
  const me = currentUser?.id;
  return !!me && (module.created_by === me || module.lead_id === me);
};

export const useCanEditCycle = (cycle?: { created_by?: string | null; owned_by_id?: string | null } | null): boolean => {
  const { data: currentUser } = useUser();
  const { allowPermissions } = useUserPermissions();
  if (!cycle) return false;
  if (allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE)) return true;
  const me = currentUser?.id;
  return !!me && (cycle.created_by === me || cycle.owned_by_id === me);
};

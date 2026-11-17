/**
 * [team 二开] 接管编辑器等发出的 loom:navigate 事件，用路由器跳转：只刷新内容区，侧栏、顶栏、头像等不重载。
 */
import { useEffect } from "react";
import { useNavigate } from "react-router";

export function AppNavigationBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const href = (e as CustomEvent<{ href?: string }>).detail?.href;
      if (!href || !href.startsWith("/")) return;
      e.preventDefault();
      void navigate(href);
    };
    window.addEventListener("loom:navigate", onNavigate);
    return () => window.removeEventListener("loom:navigate", onNavigate);
  }, [navigate]);
  return null;
}

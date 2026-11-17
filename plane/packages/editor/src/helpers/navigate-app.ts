/**
 * [team 二开] 应用内跳转：先发 loom:navigate 事件，网页端用路由器接管（只刷新内容区，侧栏、顶栏不重载）；
 * 没人接管（比如独立的公开页）时才退回整页跳转。
 */
export const navigateApp = (href: string): void => {
  const ev = new CustomEvent("loom:navigate", { detail: { href }, cancelable: true });
  if (window.dispatchEvent(ev)) window.location.assign(href);
};

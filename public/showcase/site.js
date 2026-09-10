"use strict";
let toastTimer;
function notify(message) {
  const toast = document.querySelector(".toast");
  if (!toast) return;
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.textContent = ""), 4500);
}
document.querySelectorAll("[data-copy]").forEach((button) =>
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      notify("已复制");
    } catch {
      notify("复制失败，请手动选择并复制。");
    }
  }),
);
document.querySelector("#fullscreen")?.addEventListener("click", async () => {
  try {
    const stage = document.querySelector("#stage");
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch {
    notify("当前浏览器不支持全屏，可下载 HTML 后体验。");
  }
});

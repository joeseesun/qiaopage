"use strict";
(() => {
  const dialog = document.getElementById("agent-dialog");
  const prompt = document.getElementById("install-prompt");
  const feedback = document.getElementById("agent-feedback");
  const basePrompt = prompt.value;
  let timer;
  let trigger;
  document.getElementById("close-agent-dialog").onclick = () => dialog.close();
  dialog.addEventListener("close", () => trigger?.focus());
  dialog.addEventListener("cancel", event => { event.preventDefault(); dialog.close(); trigger?.focus(); });
  document.querySelectorAll("[data-copy-agent]").forEach((button) => {
    button.onclick = async () => {
      if (button.disabled) return;
      trigger = button;
      button.disabled = true;
      try {
        let text = basePrompt;
        if (button.hasAttribute("data-invite-agent")) {
          text += "\n\n本次邀请码：" + readInvitation() + "\n自动兑换独立发布空间，无须注册。";
        } else {
          const me = await fetch("/api/v1/me", {credentials: "same-origin"});
          if (me.ok) {
            const connection = await fetch("/api/v1/agent-grant", {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json"}, body: "{}"});
            const data = await connection.json();
            if (!connection.ok) throw new Error(data.error || "暂时无法连接，请重试。");
            text = data.prompt;
          } else if (me.status !== 401) throw new Error("暂时无法连接，请重试。");
        }
        prompt.value = text;
        try { await navigator.clipboard.writeText(text); }
        catch { dialog.showModal(); prompt.focus(); prompt.select(); return; }
        const status = button.hasAttribute("data-invite-agent") ? document.getElementById("invite-copy-status") : feedback;
        status.textContent = "已复制，粘贴给你的 Agent 开始安装";
        clearTimeout(timer);
        timer = setTimeout(() => (status.textContent = ""), 3500);
      } catch (error) {
        const target = button.hasAttribute("data-invite-agent") ? document.getElementById("auth-error") : feedback;
        target.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  });
})();

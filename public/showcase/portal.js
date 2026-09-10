"use strict";
const $ = (id) => document.getElementById(id);
let invitationPrompt = "", friendsSnapshot = "", editingFriend = null, ownerFilter = null;
const pendingPublications = new Map();
let member,
  works = [],
  selected = [],
  editing = null,
  detail = null,
  inviteCode = new URLSearchParams(location.hash.slice(1)).get("invite");
const grant = new URLSearchParams(location.hash.slice(1)).get("code");
if (location.hash) history.replaceState(null, "", location.pathname);
async function api(url, method = "GET", body) {
  const r = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error("服务暂时不可用，请稍后再试。");
  }
  if (!r.ok) {
    const e = new Error(data.error || "操作未完成。");
    e.status = r.status;
    throw e;
  }
  return data;
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("toast").classList.remove("show"), 3000);
}
async function copy(value) {
  await navigator.clipboard.writeText(value);
  toast("已复制");
}
function action(fn) {
  return async (event) => {
    event?.preventDefault();
    const button = event?.currentTarget;
    const dialog = button?.closest("dialog");
    const error = dialog?.querySelector(".dialog-error") || $("global-error");
    error.textContent = "";
    if (button?.tagName === "BUTTON") button.disabled = true;
    try {
      await fn(event);
    } catch (e) {
      error.textContent = e.message;
    } finally {
      if (button?.tagName === "BUTTON") button.disabled = false;
    }
  };
}
function confirmAction(title, description) {
  return new Promise((resolve) => {
    const dialog = $("confirm-dialog");
    $("confirm-title").textContent = title;
    $("confirm-description").textContent = description;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      dialog.close();
      resolve(value);
    };
    $("confirm-ok").onclick = () => finish(true);
    $("confirm-cancel").onclick = () => finish(false);
    dialog.oncancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    dialog.showModal();
  });
}
function button(label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.onclick = action(fn);
  return b;
}
function rowText(parent, tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  parent.append(el);
  return el;
}
function date(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
async function refresh() {
  works = (await api("/api/v1/works?all=true")).works;
  $("site-count").textContent = works.length;
  renderWorks();
  $("loading").hidden = true;
}
function renderWorks() {
  const q = $("search").value.trim().toLowerCase();
  const filtered = works.filter((w) =>
    (!ownerFilter || w.owner_id === ownerFilter.id) && (w.title + " " + w.slug).toLowerCase().includes(q),
  );
  $("owner-filter").hidden = !ownerFilter;
  $("owner-filter-label").textContent = ownerFilter ? ownerFilter.note + " 的作品" : "";
  $("site-list").replaceChildren();
  $("empty").hidden = filtered.length > 0;
  $("empty").querySelector("h3").textContent = q
    ? "没有找到匹配的内容"
    : "下一个链接，从这里开始。";
  $("empty").querySelector("p").textContent = q
    ? "换个关键词试试。"
    : "发布一个文件，就会出现在这里。";
  for (const w of filtered) {
    const row = document.createElement("article");
    row.className = "site-row";
    const icon = rowText(
      row,
      "span",
      w.file_count > 1 ? "↗" : "</>",
      "site-icon " + w.theme,
    );
    icon.setAttribute("aria-hidden", "true");
    const info = document.createElement("div");
    info.className = "site-info";
    const title = rowText(info, "h3", w.title);
    const a = rowText(info, "a", w.url.replace(/^https?:\/\//, ""), "url");
    a.href = w.url;
    a.target = "_blank";
    a.rel = "noopener";
    const meta = document.createElement("div");
    meta.className = "site-meta";
    if (member.admin && w.owner_name) rowText(meta, "span", w.owner_name);
    rowText(meta, "span", w.published ? "已发布" : "已下架", "pill");
    rowText(meta, "span", w.listed ? "展厅可见" : "仅链接分享");
    rowText(
      meta,
      "span",
      `${w.file_count} 个文件 · v${w.revision} · ${date(w.updated_at)}`,
    );
    info.append(meta);
    row.append(info);
    const actions = document.createElement("div");
    actions.className = "site-actions";
    const share = button("复制链接", () => copy(w.url));
    share.disabled = !w.published;
    actions.append(
      share,
      button("管理", () => openDetail(w)),
    );
    row.append(actions);
    $("site-list").append(row);
  }
}
async function openDetail(w) {
  detail = w;
  resetSharing();
  $("detail-title").textContent = w.title;
  $("detail-url").textContent = w.url;
  $("detail-url").href = w.url;
  $("toggle-listed").textContent = w.listed ? "移出展厅" : "展示到展厅";
  $("toggle-published").textContent = w.published ? "下架链接" : "恢复发布";
  $("version-list").replaceChildren();
  $("detail-dialog").querySelector(".dialog-error").textContent = "";
  if (!$("detail-dialog").open) $("detail-dialog").showModal();
  const { versions } = await api(`/api/v1/works/${w.slug}/versions`);
  if (!versions.length)
    rowText($("version-list"), "p", "下一次更新时会保留当前版本。", "hint");
  for (const v of versions) {
    const row = document.createElement("div");
    row.className = "version-row";
    rowText(row, "span", `v${v.revision} · ${date(v.created_at)}`);
    if (v.revision === w.revision) rowText(row, "span", "当前版本", "hint");
    else
      row.append(
        button("恢复此版本", async () => {
          if (
            !(await confirmAction(
              "恢复这个版本？",
              "页面文件与标题将恢复，现有链接不变。当前内容仍保留在历史里。",
            ))
          )
            return;
          await api(`/api/v1/works/${w.slug}/rollback`, "POST", {
            version: v.revision,
            revision: detail.revision,
          });
          await refresh();
          await openDetail(works.find((x) => x.slug === w.slug));
          toast("已恢复");
        }),
      );
    $("version-list").append(row);
  }
}
async function patchDetail(change) {
  await api(`/api/v1/works/${detail.slug}`, "PATCH", {
    revision: detail.revision,
    ...change,
  });
  await refresh();
  await openDetail(works.find((w) => w.slug === detail.slug));
  toast("已保存");
}
function setTab(name, updateUrl = true) {
  if (!["sites", "guide", "members"].includes(name) || (name === "members" && !member?.admin)) name = "sites";
  document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  for (const tab of ["sites", "guide", "members"]) $(tab + "-panel").hidden = tab !== name;
  $("search").hidden = name !== "sites";
  $("greeting").hidden = name !== "sites";
  document.querySelector(".workspace-agent").hidden = name !== "sites";
  document.querySelector(".publish-box").hidden = name !== "sites";
  document.querySelector(".workspace-heading h1").textContent = name === "members" ? "朋友" : name === "guide" ? "安装与 CLI" : "发布，然后分享。";
  $("invite-button").hidden = name !== "members" || !member?.admin;
  if (updateUrl) {
    const url = new URL(location.href);
    if (name === "sites") url.searchParams.delete("tab"); else url.searchParams.set("tab", name);
    if (name === "sites" && ownerFilter) url.searchParams.set("owner", ownerFilter.id); else url.searchParams.delete("owner");
    history.replaceState(null, "", url.pathname + url.search);
  }
  if (name === "members") return refreshMembers();
}
async function refreshMembers() {
  try {
    const {friends} = await api("/api/v1/friends");
    $("friends-error").textContent = "";
    const snapshot = JSON.stringify(friends);
    if (snapshot === friendsSnapshot) return;
    friendsSnapshot = snapshot;
    const focused = document.activeElement?.closest("[data-friend-id]")?.dataset.friendId;
    $("member-list").replaceChildren();
    $("friends-empty").hidden = friends.length > 0;
    document.querySelector(".friends-table").hidden = friends.length === 0;
    const states = {joined:"已加入",pending:"待加入",expired:"邀请过期",revoked:"已撤销",disabled:"已停用"};
    for (const friend of friends) {
      const row = document.createElement("tr");
      row.className = "friend-row";
      row.dataset.friendId = friend.id;
      const name = rowText(row, "td", "", "friend-name");
      rowText(name, "span", friend.note);
      const state = rowText(row, "td", "", "friend-state");
      rowText(state, "span", states[friend.state], "friend-badge " + friend.state);
      rowText(row, "td", friend.member_id ? String(friend.works_count) : "—", friend.member_id ? "friend-count" : "friend-count no-works");
      const actions = rowText(row, "td", "", "friend-actions");
      if (friend.member_id) actions.append(button("查看作品", async () => {
        ownerFilter = {id:friend.member_id,note:friend.note};
        $("search").value = "";
        await refresh();
        setTab("sites");
        $("owner-filter").scrollIntoView({block:"nearest"});
      }));
      else if (friend.state !== "pending") actions.append(button("重新邀请", () => reissueInvitation(friend)));
      const menu = document.createElement("details");
      menu.className = "friend-menu";
      const summary = rowText(menu, "summary", "···");
      summary.setAttribute("aria-label", friend.note + "的更多操作");
      menu.addEventListener("toggle", () => {
        if (menu.open) document.querySelectorAll(".friend-menu[open]").forEach(other => {if (other !== menu) other.open = false;});
      });
      menu.addEventListener("keydown", event => {if(event.key === "Escape") {menu.open=false;summary.focus();event.stopPropagation();}});
      const options = rowText(menu, "div", "", "friend-menu-options");
      const option = (label, fn) => options.append(button(label, async () => {menu.open = false; await fn();}));
      if (friend.member_id) {
        option("修改备注", () => {
          editingFriend = friend;
          $("note-form").elements.note.value = friend.note;
          $("note-dialog").querySelector(".dialog-error").textContent = "";
          $("note-dialog").showModal();
        });
        if (friend.state === "joined") option("恢复连接", async () => {
          if (!(await confirmAction("为“" + friend.note + "”恢复连接？", "请确认请求来自这位朋友。新连接生效后，旧 Agent 连接和网页登录状态会失效，原作品保留。"))) return;
          const data = await api("/api/v1/members/" + friend.member_id + "/recovery", "POST", {});
          await showInvitation(data, true);
        });
        option(friend.state === "disabled" ? "启用" : "停用", async () => {
          const disabled = friend.state !== "disabled";
          if (!(await confirmAction((disabled ? "停用“" : "启用“") + friend.note + "”？", disabled ? "将撤销这位朋友的登录与 Agent 连接。已发布的作品仍可访问，如需撤回，请另外下架。" : "恢复使用资格后，可生成恢复 Prompt 帮他重新连接。"))) return;
          await api("/api/v1/members/" + friend.member_id, "PATCH", {disabled});
          await refreshMembers();
        });
      } else {
        if (friend.state === "pending") option("重新生成邀请", () => reissueInvitation(friend));
        if (friend.state === "pending" || friend.state === "expired") option("撤销邀请", async () => {
          if (!(await confirmAction("撤销“" + friend.note + "”的邀请？", "已发出的邀请将失效。之后仍可以重新邀请。"))) return;
          await api("/api/v1/invites/" + friend.id, "DELETE");
          await refreshMembers();
        });
      }
      if (options.children.length) {actions.append(menu);}
      $("member-list").append(row);
    }
    if (focused) document.querySelector(`[data-friend-id="${focused}"] summary`)?.focus();
  } catch (error) { $("friends-error").textContent = error.message + " 点击“朋友”重试。"; }
}
async function reissueInvitation(friend) {
  if (friend.state === "pending" && !(await confirmAction("重新生成“" + friend.note + "”的邀请？", "旧邀请会失效，请把新的 Prompt 发给朋友。"))) return;
  const data = await api("/api/v1/invites/" + friend.id + "/reissue", "POST", {});
  await showInvitation(data);
  await refreshMembers();
}
document.addEventListener("click", event => {
  document.querySelectorAll(".friend-menu[open]").forEach(menu => {if (!menu.contains(event.target)) menu.open=false;});
});
setInterval(() => {
  if (member?.admin && !document.hidden && !$("members-panel").hidden && !document.querySelector("dialog[open],.friend-menu[open]")) refreshMembers();
}, 10000);
$("clear-owner-filter").onclick = () => {ownerFilter=null;renderWorks();setTab("sites");};
$("note-form").onsubmit = action(async event => {
  const submit = event.target.querySelector("button");
  submit.disabled = true;
  try {
    await api("/api/v1/members/" + editingFriend.member_id, "PATCH", {note:event.target.elements.note.value});
    $("note-dialog").close();
    await refreshMembers();
    toast("备注已保存");
  } finally {submit.disabled=false;}
});
const safePath = (p) =>
  p
    .split("/")
    .every(
      (x) => x && !/^(?:\..*|node_modules|.*\.(pem|key|sqlite|db))$/i.test(x),
    );
async function selectFiles(input) {
  $("publish-error").textContent = "";
  $("global-error").textContent = "";
  let files = input.filter((x) => safePath(x.path));
  const skipped = input.length - files.length;
  if (!files.length)
    throw new Error("没有可发布的文件。隐藏文件、密钥与数据库会被排除。");
  if (
    files.length > 100 ||
    files.reduce((n, x) => n + x.file.size, 0) > 8 * 1024 * 1024 ||
    files.some((x) => x.file.size > 5 * 1024 * 1024)
  )
    throw new Error("单文件最多 5 MB，合计 8 MB、100 个文件。");
  if (files.length === 1) {
    const name = files[0].path;
    if (/\.(md|markdown)$/i.test(name))
      files = [{ ...files[0], path: "index.md" }];
    else if (/\.html?$/i.test(name))
      files = [{ ...files[0], path: "index.html" }];
    else throw new Error("请选择 HTML、Markdown，或包含首页的网站文件夹。");
  }
  if (!files.some((x) => /^index\.(html|md|markdown)$/.test(x.path)))
    throw new Error("网站文件夹需要 index.html 或 index.md 作为首页。");
  selected = files;
  $("publish-form").hidden = false;
  $("dropzone").hidden = true;
  $("publish-success").hidden = true;
  $("file-summary").textContent =
    `${files.length} 个文件 · ${(files.reduce((n, x) => n + x.file.size, 0) / 1024).toFixed(1)} KB${skipped ? " · 已排除 " + skipped + " 个隐藏或敏感文件" : ""}`;
  const f = $("publish-form");
  f.elements.title.value =
    editing?.title || input[0].file.name.replace(/\.[^.]+$/, "");
  f.elements.slug.value = editing?.slug || "";
  f.elements.slug.readOnly = !!editing;
  $("publish-link-settings").open = false;
  f.elements.listed.checked = editing?.listed || false;
  $("publish-submit").textContent = editing
    ? "更新这个链接 ↗"
    : "发布并获取链接 ↗";
  f.elements.title.focus();
}
function clearFiles() {
  selected = [];
  editing = null;
  $("publish-heading").textContent = "把文件放到这里";
  $("publish-form").reset();
  $("publish-form").hidden = true;
  $("dropzone").hidden = false;
  $("file-input").value = "";
  $("folder-input").value = "";
  $("publish-success").hidden = true;
}
function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
$("file-input").onchange = action((e) =>
  selectFiles([...e.target.files].map((file) => ({ file, path: file.name }))),
);
$("folder-input").onchange = action((e) =>
  selectFiles(
    [...e.target.files].map((file) => ({
      file,
      path: file.webkitRelativePath.split("/").slice(1).join("/"),
    })),
  ),
);
$("file-input").addEventListener("cancel", () => {
  if (editing) clearFiles();
});
$("choose-folder").onclick = () => $("folder-input").click();
$("dropzone").onclick = () => $("file-input").click();
$("dropzone").onkeydown = (e) => {
  if (["Enter", " "].includes(e.key)) {
    e.preventDefault();
    $("file-input").click();
  }
};
$("dropzone").ondragover = (e) => {
  e.preventDefault();
  $("dropzone").classList.add("dragging");
};
$("dropzone").ondragleave = () => $("dropzone").classList.remove("dragging");
$("dropzone").ondrop = action(async (e) => {
  e.preventDefault();
  $("dropzone").classList.remove("dragging");
  const entries = [...e.dataTransfer.items]
    .map((i) => i.webkitGetAsEntry?.())
    .filter(Boolean);
  const found = [];
  async function walk(entry, prefix = "") {
    if (!safePath(entry.name)) return;
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) =>
        entry.file(resolve, reject),
      );
      found.push({ file, path: prefix + entry.name });
      if (found.length > 100) throw new Error("最多 100 个文件。");
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        for (const child of batch) await walk(child, prefix + entry.name + "/");
      } while (batch.length);
    }
  }
  if (entries.length) {
    for (const entry of entries) await walk(entry);
    if (entries.length === 1 && entries[0].isDirectory)
      found.forEach((f) => (f.path = f.path.split("/").slice(1).join("/")));
  } else
    for (const file of e.dataTransfer.files)
      found.push({ file, path: file.name });
  await selectFiles(found);
});
$("clear-files").onclick = clearFiles;
$("publish-another").onclick = clearFiles;
$("publish-form").onsubmit = async (e) => {
  e.preventDefault();
  $("publish-error").textContent = "";
  const submit = $("publish-submit");
  submit.disabled = true;
  submit.textContent = "正在发布…";
  try {
    const f = e.target;
    const files = [];
    for (const item of selected)
      files.push({
        path: item.path,
        data: base64(await item.file.arrayBuffer()),
      });
    const body = {
      title: f.elements.title.value,
      files,
      listed: f.elements.listed.checked,
      ...(editing
        ? {
            revision: editing.revision,
            description: editing.description,
            tags: editing.tags,
            theme: editing.theme,
            published: editing.published,
          }
        : {}),
    };
    let pendingKey;
    if (!editing) {
      if (f.elements.slug.value.trim()) body.slug = f.elements.slug.value.trim();
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({member: member.id, body})));
      pendingKey = "quickshare-publish-" + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      // Only an opaque request ID is stored; source files and credentials stay out of browser storage.
      body.requestId = pendingPublications.get(pendingKey);
      try { body.requestId ||= sessionStorage.getItem(pendingKey); } catch {}
      body.requestId ||= crypto.randomUUID();
      pendingPublications.set(pendingKey, body.requestId);
      try { sessionStorage.setItem(pendingKey, body.requestId); } catch {}
    }
    const { work } = await api(
      editing ? "/api/v1/works/" + encodeURIComponent(editing.slug) : "/api/v1/works",
      editing ? "PUT" : "POST",
      body,
    );
    if (pendingKey) {
      pendingPublications.delete(pendingKey);
      try { sessionStorage.removeItem(pendingKey); } catch {}
    }
    clearFiles();
    $("publish-success").hidden = false;
    $("published-url").textContent = work.url;
    $("published-url").href = work.url;
    $("copy-published").onclick = action(() => copy(work.url));
    await refresh();
    toast(work.published ? "已发布" : "草稿已更新，恢复发布后可访问");
  } catch (error) {
    $("publish-error").textContent = error instanceof TypeError
      ? "连接中断，请重试发布。重复请求不会创建第二个网站。" : error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = editing ? "更新这个链接 ↗" : "发布并获取链接 ↗";
  }
};
$("search").oninput = renderWorks;
document
  .querySelectorAll("[data-tab]")
  .forEach((b) => (b.onclick = action(() => setTab(b.dataset.tab))));
$("update-files").onclick = () => {
  const w = detail;
  $("detail-dialog").close();
  clearFiles();
  editing = w;
  $("publish-heading").textContent = "更新：" + w.title;
  $("file-input").click();
  $("dropzone").scrollIntoView({ behavior: "smooth", block: "center" });
};
$("toggle-listed").onclick = action(() =>
  patchDetail({ listed: !detail.listed }),
);
$("toggle-published").onclick = action(async () => {
  if (
    detail.published &&
    !(await confirmAction(
      "下架这个链接？",
      "访问者将暂时无法打开。内容与历史版本保留，可以随时恢复发布。",
    ))
  )
    return;
  await patchDetail({ published: !detail.published });
});
$("invite-button").onclick = () => {
  $("invite-title").textContent = "邀请朋友";
  $("invite-form").reset();
  $("invite-form").hidden = false;
  $("invite-result").hidden = true;
  $("invite-dialog").querySelector(".dialog-error").textContent = "";
  $("invite-dialog").showModal();
};
async function copyInvitation() {
  try {
    await navigator.clipboard.writeText(invitationPrompt);
    $("invite-result-message").textContent = "已复制，发给朋友即可";
  } catch {
    $("invite-result-message").textContent = "邀请已生成，请手动复制下方 Prompt";
    $("invite-manual").open = true;
    $("invite-prompt-value").focus();
    $("invite-prompt-value").select();
  }
}
async function showInvitation(data, recovery = false) {
  invitationPrompt = data.prompt;
  $("invite-title").textContent = recovery ? "恢复连接" : "邀请朋友";
  $("invite-prompt-value").value = data.prompt;
  $("invite-url").value = data.url || "";
  $("invite-alternative").hidden = recovery;
  $("invite-alternative").open = false;
  $("invite-manual").open = false;
  $("invite-form").hidden = true;
  $("invite-result").hidden = false;
  $("invite-result-help").textContent = recovery ? "让朋友交给 Agent，接回原来的空间。24 小时内有效。" : "把这段 Prompt 发给朋友，他交给 Agent 即可开始。";
  $("copy-invite-prompt").textContent = recovery ? "复制恢复 Prompt" : "复制邀请 Prompt";
  $("invite-dialog").querySelector(".dialog-error").textContent = "";
  if (!$("invite-dialog").open) $("invite-dialog").showModal();
  await copyInvitation();
}
$("invite-form").onsubmit = action(async event => {
  const submit = event.target.querySelector("button");
  submit.disabled = true;
  try {
    const data = await api("/api/v1/invites", "POST", {label:event.target.elements.label.value});
    await showInvitation(data);
    await refreshMembers();
  } finally {submit.disabled = false;}
});
$("copy-invite").onclick = action(() => copy($("invite-url").value));
$("copy-invite-prompt").onclick = action(copyInvitation);
let accountState;
$("account-button").onclick = action(async () => {
  accountState = null;
  $("account-name").textContent = "正在读取账号…";
  $("password-form").hidden = true;
  $("key-result").hidden = true; $("key-value").value = "";
  $("account-dialog").querySelector(".dialog-error").textContent = "";
  $("account-dialog").showModal();
  try {
    const data = await api("/api/v1/account");
    if (!$("account-dialog").open) return;
    accountState = data.account;
    $("account-name").textContent = `#${accountState.id} · ${accountState.role === "admin" ? "管理员" : "普通成员"}`;
    $("password-form").reset();
    $("password-form").elements.username.value = accountState.username;
    $("password-form").hidden = false;
  } catch (e) { $("account-dialog").querySelector(".dialog-error").textContent = e.message; }
});
$("password-form").onsubmit = action(async (e) => {
  if (!accountState) return;
  const form = e.target, submit = $("account-save");
  const username = form.elements.username.value, password = form.elements.password.value;
  if (username === accountState.username && !password) { toast("账号信息未改变"); return; }
  submit.disabled = true;
  try {
    const data = await api("/api/v1/account", "PATCH", {revision:accountState.revision, ...(username !== accountState.username ? {username} : {}), ...(password ? {password} : {})});
    accountState = data.account;
    member = (await api("/api/v1/me")).member;
    form.elements.password.value = "";
    form.elements.username.value = accountState.username;
    $("account-name").textContent = `#${accountState.id} · ${accountState.role === "admin" ? "管理员" : "普通成员"}`;
    $("greeting").textContent = accountState.username + " 的发布空间";
    toast(password ? "密码已保存" : "用户名已保存");
  } finally { submit.disabled = false; }
});
$("new-key").onclick = action(async () => {
  if (
    !(await confirmAction(
      "生成新的 CLI 令牌？",
      "此前所有 Agent 和 CLI 连接将立即失效。生成后请复制并妥善保存。",
    ))
  )
    return;
  const { token } = await api("/api/v1/key", "POST", {});
  $("key-value").value = token;
  $("key-result").hidden = false;
});
$("copy-key").onclick = action(() => copy($("key-value").value));
$("logout").onclick = action(async () => {
  if (!member.registered && !(await confirmAction("退出发布空间？", "尚未设置登录账号。退出后，需要已连接的 Agent 帮你重新打开空间；也可以取消并先设置账号。"))) return;
  await api("/auth/logout", "POST", {});
  location.href = "/";
});
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
$("account-dialog").onclose = () => {
  $("key-value").value = "";
  $("password-form").reset();
};
$("invite-dialog").onclose = () => {
  $("invite-url").value = "";
  $("invite-prompt-value").value = "";
  invitationPrompt = "";
};
function authMode(mode) {
  const joining = mode === "invite";
  $("auth-form").dataset.mode = mode;
  $("auth-title").textContent = joining ? "你的作品，即刻出发。" : "欢迎回来";
  $("join-field").hidden = !joining;
  $("join-code").required = joining;
  $("auth-credentials").hidden = joining;
  for (const name of ["username", "password"]) $("auth-form").elements[name].required = !joining;
  $("invite-agent").hidden = !joining;
  $("auth-submit").textContent = joining ? "免注册开始使用" : "登录";
  $("auth-switch").textContent = joining ? "已有账号？登录" : "有邀请码？直接开始";
  $("auth-error").textContent = "";
}
$("login-button").onclick = () => { authMode("login"); $("auth-dialog").showModal(); };
$("join-button").onclick = () => { authMode("invite"); $("auth-dialog").showModal(); };
$("auth-switch").onclick = () => authMode($("auth-form").dataset.mode === "login" ? "invite" : "login");
function readInvitation() {
  let code = $("join-code").value.trim();
  if (code.includes("://")) {
    const url = new URL(code);
    if (url.origin !== location.origin || url.pathname !== "/join" || url.search) throw new Error("请使用本站的邀请链接。");
    code = new URLSearchParams(url.hash.slice(1)).get("invite") || "";
  }
  code = code.replace(/[\s-]/g, "").toLowerCase();
  if (!/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(code)) throw new Error("请输入完整的邀请码。");
  return code;
}
$("auth-dialog").onclose = () => {
  $("auth-form").elements.password.value = "";
};
async function start() {
  if (grant) await api("/auth/grant", "POST", { code: grant });
  try {
    member = (await api("/api/v1/me")).member;
  } catch (e) {
    if (e.status !== 401) throw e;
  }
  $("welcome").hidden = !!member;
  $("workspace").hidden = !member;
  $("account-button").hidden = !member;
  $("logout").hidden = !member;
  $("login-button").hidden = !!member;
  if (!member) {
    $("join-button").hidden = false;
    $("join-code").value = inviteCode || "";
    authMode(inviteCode || location.pathname === "/join" ? "invite" : "login");
    if (inviteCode || ["/login", "/join", "/dashboard"].includes(location.pathname)) $("auth-dialog").showModal();
    return;
  }
  if (member.admin)
    document.querySelector("[data-tab=sites]").firstChild.textContent =
      "全部内容 ";
  $("greeting").textContent = member.registered ? member.username + " 的发布空间" : "你的发布空间";
  $("members-tab").hidden = !member.admin;
  $("invite-button").hidden = true;
  $("cli-example").textContent =
    `node quickshare.js login --url ${location.origin} --token-stdin < token.txt\nnode quickshare.js publish ./index.html\nnode quickshare.js publish ./my-site\nnode quickshare.js update my-site ./my-site`;
  await refresh();
  const owner = Number(new URLSearchParams(location.search).get("owner"));
  if (member.admin && owner > 0) {
    const work = works.find(w => w.owner_id === owner);
    ownerFilter = {id:owner,note:work?.owner_name || "这位朋友"};
    renderWorks();
  }
  await setTab(new URLSearchParams(location.search).get("tab") || "sites", false);
}
$("auth-form").onsubmit = async (e) => {
  e.preventDefault();
  const b = $("auth-submit");
  b.disabled = true;
  $("auth-error").textContent = "";
  try {
    const joining = $("auth-form").dataset.mode === "invite";
    await api(joining ? "/auth/accept" : "/auth/login", "POST", {
      username: e.target.elements.username.value,
      password: e.target.elements.password.value,
      ...(joining ? { invite: readInvitation() } : {}),
    });
    location.href = "/dashboard";
  } catch (error) {
    $("auth-error").textContent = error.message;
  } finally {
    b.disabled = false;
  }
};
start().catch((e) => {
  $("global-error").textContent = e.message;
  $("welcome").hidden = false;
});

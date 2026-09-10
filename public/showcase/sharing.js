"use strict";
let sharingState = null, sharingSlug = null, sharingImage, sharingSequence = 0, sharingTimer;
function resetSharing() {
  sharingSequence++; clearTimeout(sharingTimer);
  sharingState = null; sharingSlug = detail.slug; sharingImage = undefined;
  $("sharing-settings").open = false; $("sharing-form").hidden = true;
  $("sharing-loading").hidden = false; $("sharing-loading").textContent = "正在读取分享设置…";
  $("sharing-error").textContent = ""; $("share-image").value = "";
}
function sharingBody() {
  return { enabled: $("share-enabled").checked, indexable: $("share-indexable").checked, title: $("share-title").readOnly ? sharingState.title : $("share-title").value, description: $("share-description").readOnly ? sharingState.description : $("share-description").value, ...(sharingImage === undefined ? {} : { image: sharingImage }), revision: sharingState.revision, shareRevision: sharingState.shareRevision };
}
function renderSharingPreview(data) {
  const p = data.preview;
  $("share-preview-title").textContent = p.title;
  $("share-preview-description").textContent = p.description;
  $("share-preview-image").src = p.image || "data:,";
  $("share-preview-image").hidden = false;
  $("share-source-warning").hidden = !p.noindex;
  $("share-fields").hidden = !$("share-enabled").checked;
  $("share-preview-hint").textContent = $("share-enabled").checked
    ? "卡片示意，实际样式与缓存由分享平台决定。" : "分享增强已关闭。以下为启用后的预览，当前页面保持原样。";
  $("share-remove").hidden = !data.hasImage || p.locked.image;
  $("share-image").disabled = p.locked.image;
  $("share-cover-hint").textContent = p.locked.image ? "使用页面已有的 OG 封面" : "PNG、JPEG、WebP · 2 MB 内";
}
$("share-preview-image").addEventListener("error", () => { $("share-preview-image").hidden = true; $("share-preview-hint").textContent = "封面暂时无法预览，请检查原页面的图片地址。"; });
$("sharing-settings").addEventListener("toggle", async () => {
  if (!$("sharing-settings").open || sharingState) return;
  const slug = sharingSlug, sequence = ++sharingSequence;
  try {
    const data = await api(`/api/v1/works/${slug}/sharing`);
    if (sequence !== sharingSequence || slug !== sharingSlug) return;
    sharingState = data;
    $("share-enabled").checked = data.enabled; $("share-indexable").checked = data.indexable;
    for (const field of ["title", "description"]) {
      const input = $("share-" + field);
      input.value = data.preview.locked[field] ? data.preview[field] : data[field];
      input.readOnly = data.preview.locked[field]; input.placeholder = data.preview[field];
    }
    $("sharing-loading").hidden = true; $("sharing-form").hidden = false;
    renderSharingPreview(data);
  } catch (e) { if (sequence === sharingSequence) $("sharing-loading").textContent = e.message; }
});
function scheduleSharingPreview() {
  if (!sharingState) return;
  clearTimeout(sharingTimer);
  const sequence = ++sharingSequence, slug = sharingSlug;
  sharingTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/v1/works/${slug}/sharing-preview`, "POST", sharingBody());
      if (sequence !== sharingSequence) return;
      renderSharingPreview(data); $("sharing-error").textContent = "";
    } catch (e) { if (sequence === sharingSequence) $("sharing-error").textContent = e.message; }
  }, 450);
}
for (const id of ["share-title", "share-description", "share-enabled", "share-indexable"]) $(id).addEventListener("input", scheduleSharingPreview);
$("share-image").addEventListener("change", async () => {
  const file = $("share-image").files[0], slug = sharingSlug;
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { $("sharing-error").textContent = "封面不能超过 2 MB。"; return; }
  const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(Error("无法读取封面文件。")); r.readAsDataURL(file); }).catch(e => { $("sharing-error").textContent = e.message; });
  if (!data || slug !== sharingSlug) return;
  sharingImage = data.split(",")[1]; scheduleSharingPreview();
});
$("share-remove").addEventListener("click", () => { sharingImage = null; $("share-image").value = ""; scheduleSharingPreview(); });
$("sharing-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!sharingState) return;
  clearTimeout(sharingTimer); const sequence = ++sharingSequence, slug = sharingSlug;
  $("share-save").disabled = true;
  try {
    const data = await api(`/api/v1/works/${slug}/sharing`, "PATCH", sharingBody());
    if (sequence !== sharingSequence) return;
    sharingState = data; sharingImage = undefined; renderSharingPreview(data);
    $("sharing-error").textContent = ""; toast("分享设置已保存");
  } catch (e) { if (sequence === sharingSequence) $("sharing-error").textContent = e.message; }
  finally { $("share-save").disabled = false; }
});

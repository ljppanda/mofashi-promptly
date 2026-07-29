// views/import.ts — 模板导入（与下载形成闭环，Component 模式）。
import { Store } from "../store.js";

// 触发文件选择，选中后归一化并落地为草稿，跳转详情页
export function openImportFile(): void {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".json,application/json";
  inp.onchange = () => { if (inp.files && inp.files[0]) importTemplate(inp.files[0]); };
  inp.click();
}

// 把任意已知格式归一化为模板定义：支持“模板定义 JSON”(含 prompt) 与 “成品 OpenAI JSON”(含 messages)
export function normalizeImport(d: any): any {
  if (d && typeof d.prompt === "string") {
    return {
      title: d.title || "导入的模板",
      industry: d.industry || "其他",
      task: d.task || "自定义",
      summary: d.summary || "",
      tags: Array.isArray(d.tags) ? d.tags : [],
      variables: Array.isArray(d.variables) ? d.variables : [],
      prompt: d.prompt,
      slug: "", generated: false, imported: false
    };
  }
  if (d && Array.isArray(d.messages)) {
    const lastUser = d.messages.slice().reverse().find(m => m && m.role === "user");
    let content = "";
    if (lastUser) content = typeof lastUser.content === "string" ? lastUser.content : JSON.stringify(lastUser.content);
    return {
      title: d.title || "导入的提示词",
      industry: d.industry || "其他",
      task: "自定义",
      summary: "",
      tags: [],
      variables: [],
      prompt: content,
      slug: "", generated: false, imported: false
    };
  }
  return null;
}

export function importTemplate(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string);
      const obj = normalizeImport(data);
      if (!obj) { alert("无法识别的模板文件格式（需含 prompt 或 messages 字段）。"); return; }
      obj.slug = "import-" + Date.now();
      obj.generated = true;
      obj.imported = true;
      window.__draft = obj; // 走详情页渲染，可继续编辑 / 收藏
      Store.saveDraft(obj); // 持久化草稿，刷新后仍可找回
      location.hash = "#/t/" + obj.slug;
    } catch (e) {
      alert("解析失败：" + (e as any).message);
    }
  };
  reader.onerror = () => alert("读取文件失败");
  reader.readAsText(file);
}

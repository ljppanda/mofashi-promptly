// 从 src/templates.js 生成示例模板文件到 samples/（供用户下载 / 导入参考）
global.window = {};
require("./src/templates.js");
const all = global.window.TEMPLATES;
const slugs = ["legal-advisor", "legal-nda", "family-doctor", "medical-fitness", "office-resume", "edu-study-plan", "ecom-xhs-seeding", "finance-budget", "writing-moments", "code-review", "dev-readme", "product-copy", "life-travel"];
const fs = require("fs");
if (!fs.existsSync("samples")) fs.mkdirSync("samples");
let n = 0;
slugs.forEach(slug => {
  const t = all.find(x => x.slug === slug);
  if (!t) return;
  const def = {
    title: t.title, industry: t.industry, task: t.task,
    summary: t.summary, tags: t.tags, variables: t.variables, prompt: t.prompt
  };
  fs.writeFileSync("samples/" + slug + ".json", JSON.stringify(def, null, 2));
  n++;
  console.log("wrote samples/" + slug + ".json");
});
console.log("done, " + n + " files");

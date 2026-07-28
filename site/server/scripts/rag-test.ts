import { retrieve } from "../src/rag.js";

async function main() {
  for (const q of [
    { ind: "生活/个人效率", s: "帮我做一个让AI当营养师、给我排每周饮食计划的模板" },
    { ind: "法律", s: "写个帮我审租房合同的模板" },
    { ind: "编程开发", s: "做一个让AI帮我做代码审查的提示词模板" },
    { ind: "电商运营", s: "帮我写小红书种草文案的模板" },
  ]) {
    const r = await retrieve(q.ind, q.s, 4);
    console.log(`\n=== [${q.ind}] ${q.s}`);
    console.log("  " + r.refs.map((x) => `${x.title}(${x.industry})`).join("  |  "));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

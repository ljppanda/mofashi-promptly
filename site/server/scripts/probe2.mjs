import { pipeline } from "@xenova/transformers";
console.log("loading model...");
const t0 = Date.now();
const extractor = await pipeline("feature-extraction", "Xenova/paraphrase-multilingual-MiniLM-L6-v2");
console.log("loaded in", ((Date.now() - t0) / 1000).toFixed(1), "s");
const a = await extractor("每周饮食计划 营养师 卡路里 蛋白质", { pooling: "mean", normalize: true });
const b = await extractor("帮我做一个让AI当营养师排每周食谱的模板", { pooling: "mean", normalize: true });
const c = await extractor("审租房合同 法律风险", { pooling: "mean", normalize: true });
function sim(x, y) { let s = 0; for (let i = 0; i < x.data.length; i++) s += x.data[i] * y.data[i]; return s; }
console.log("dim", a.data.length);
console.log("diet~dietQ sim:", sim(a, b).toFixed(3));
console.log("diet~contract sim:", sim(a, c).toFixed(3));

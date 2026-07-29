// localStorage 封装：设置（LLM Key/模型）、“我的模板”与“AI 草稿”
export const Store = (function () {
  const K_SETTINGS = "ppt_settings";
  const K_MINE = "ppt_my_templates";
  const K_DRAFTS = "ppt_drafts";   // AI 生成 / 导入的草稿：持久化，刷新不丢
  const K_RATINGS = "ppt_ratings"; // 本人对各模板的评分（slug -> 1-5），用于“改评”差值计算
  const K_COMM_FAVS = "ppt_community_favs"; // 社区收藏（id -> true）

  function getSettings() {
    try { return JSON.parse(localStorage.getItem(K_SETTINGS)) || {}; }
    catch (e) { return {}; }
  }
  function saveSettings(s) {
    localStorage.setItem(K_SETTINGS, JSON.stringify(s));
  }

  function getMine() {
    try { return JSON.parse(localStorage.getItem(K_MINE)) || []; }
    catch (e) { return []; }
  }
  function saveMine(arr) {
    localStorage.setItem(K_MINE, JSON.stringify(arr));
  }
  function addMine(t) {
    const arr = getMine();
    const idx = arr.findIndex(x => x.slug === t.slug);
    if (idx >= 0) {
      const old = arr[idx];
      const snap = {
        title: old.title, summary: old.summary, industry: old.industry, task: old.task,
        prompt: old.prompt, variables: old.variables
      };
      const versions = (old.versions || []).slice();
      const last = versions[0];
      const same = last && JSON.stringify(last.snap) === JSON.stringify(snap);
      if (!same) {
        versions.unshift({ ts: Date.now(), snap });
        if (versions.length > 30) versions.length = 30; // 限 30 版，防膨胀
      }
      t.versions = versions;
      arr.splice(idx, 1);
    } else {
      t.versions = t.versions || [];
    }
    arr.unshift(t);
    saveMine(arr);
    return arr;
  }
  function removeMine(slug) {
    const arr = getMine().filter(x => x.slug !== slug);
    saveMine(arr);
    return arr;
  }
  function hasMine(slug) {
    return getMine().some(x => x.slug === slug);
  }

  function getDrafts() {
    try { return JSON.parse(localStorage.getItem(K_DRAFTS)) || []; }
    catch (e) { return []; }
  }
  function saveDraft(t) {
    const arr = getDrafts().filter(x => x.slug !== t.slug);
    arr.unshift(t);
    localStorage.setItem(K_DRAFTS, JSON.stringify(arr));
    return arr;
  }
  function removeDraft(slug) {
    const arr = getDrafts().filter(x => x.slug !== slug);
    localStorage.setItem(K_DRAFTS, JSON.stringify(arr));
    return arr;
  }
  function hasDraft(slug) {
    return getDrafts().some(x => x.slug === slug);
  }

  // 优先我的模板，其次草稿
  function findAny(slug) {
    return getMine().find(x => x.slug === slug) || getDrafts().find(x => x.slug === slug) || null;
  }

  function getRatings() {
    try { return JSON.parse(localStorage.getItem(K_RATINGS)) || {}; }
    catch (e) { return {}; }
  }
  function getRating(slug) {
    const r = getRatings();
    return r[slug] || 0;
  }
  function setRating(slug, score) {
    const r = getRatings();
    r[slug] = score;
    localStorage.setItem(K_RATINGS, JSON.stringify(r));
  }

  function getCommunityFavs() {
    try { return JSON.parse(localStorage.getItem(K_COMM_FAVS)) || {}; }
    catch (e) { return {}; }
  }
  function hasCommunityFav(id) {
    return !!getCommunityFavs()[id];
  }
  function setCommunityFav(id, on) {
    const f = getCommunityFavs();
    if (on) f[id] = true; else delete f[id];
    localStorage.setItem(K_COMM_FAVS, JSON.stringify(f));
  }

  return { getSettings, saveSettings, getMine, addMine, removeMine, hasMine,
           getDrafts, saveDraft, removeDraft, hasDraft, findAny,
           getRating, setRating, hasCommunityFav, setCommunityFav };
})();

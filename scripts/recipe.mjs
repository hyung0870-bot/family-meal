// 레시피 도구
//   node scripts/recipe.mjs find "궁중떡볶이" "소고기무국" ...  만개의레시피에서 재료에 매운 게 없는 레시피를 찾는다
//   node scripts/recipe.mjs check plan.json                     plan 의 메인 레시피 링크가 열리는지, 매운 재료면 note 로 안내했는지 검사
import { readFileSync } from "node:fs";

const SPICY = ["고춧가루", "고추장", "고추", "청양", "땡초", "스리라차", "핫소스", "고추기름", "페퍼론치노", "김치"];
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36" };
const SITE = "https://www.10000recipe.com";

// 레시피 페이지의 재료 영역에서 매운 재료를 찾는다. 백김치는 허용.
const spicyIn = (text) => { const t = text.replace(/백김치/g, ""); return SPICY.filter((w) => t.includes(w)); };

async function inspect(url) {
  if (/youtube\.com\/watch\?v=|youtu\.be\//.test(url)) {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { headers: UA });
    if (!r.ok) return { ok: false, why: `유튜브 영상 없음 (${r.status})` };
    const j = await r.json();
    return { ok: true, title: j.title, spicy: spicyIn(j.title) };
  }
  const r = await fetch(url, { headers: UA, redirect: "follow" });
  if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
  const html = await r.text();
  const title = (html.match(/<title[^>]*>([^<]*)/i)?.[1] || "").trim();
  // 만개의레시피는 없는 레시피에도 200 을 주고 제목이 비어 있다.
  if (!title) return { ok: false, why: "레시피 없음/삭제" };
  // 재료는 페이지의 구조화 데이터(JSON-LD recipeIngredient)에서 읽는다. 없으면 제목만 본다.
  const ingre = html.match(/"recipeIngredient"\s*:\s*(\[[^\]]*\])/)?.[1] || "";
  return { ok: true, title, spicy: spicyIn(ingre + title) };
}

async function find(q) {
  const html = await (await fetch(`${SITE}/recipe/list.html?q=${encodeURIComponent(q)}&order=reco`, { headers: UA })).text();
  const cands = [...html.matchAll(/common_sp_caption_tit[^>]*><a href="(\/recipe\/\d+)">([^<]*)/g)].slice(0, 6);
  for (const [, path, title] of cands) {
    const res = await inspect(SITE + path);
    if (res.ok && !res.spicy.length && !spicyIn(title).length) return { q, url: SITE + path, title };
  }
  return { q, url: null, why: `안 매운 후보 없음 (${cands.length}개 확인)` };
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "find") {
  for (const r of await Promise.all(args.map((q) => find(q).catch((e) => ({ q, url: null, why: e.message }))))) console.log(JSON.stringify(r));
} else if (cmd === "check") {
  const plan = JSON.parse(readFileSync(args[0], "utf8"));
  let fails = 0;
  const lines = await Promise.all(plan.days.flatMap((d) => ["breakfast", "lunch", "dinner"].map(async (k) => {
    const m = d[k];
    const res = await inspect(m.recipeUrl).catch((e) => ({ ok: false, why: e.message }));
    const head = `${d.date} ${k} ${m.name}: `;
    if (!res.ok) { fails++; return head + `❌ ${res.why} ${m.recipeUrl}`; }
    if (res.spicy.length && !/빼|대신|생략|넣지/.test(m.note || "")) { fails++; return head + `❌ 레시피에 ${res.spicy.join(",")} 있음 → note 에 빼는/대체하는 법을 적을 것`; }
    return head + `✅ ${res.title}${res.spicy.length ? ` (레시피의 ${res.spicy.join(",")} → note 로 안내함)` : ""}`;
  })));
  console.log(lines.join("\n") + (fails ? `\n\n문제 ${fails}건` : "\n\n모든 링크 정상"));
  process.exit(fails ? 1 : 0);
} else {
  console.log('사용: node scripts/recipe.mjs find "메뉴" ... | check plan.json');
  process.exit(1);
}

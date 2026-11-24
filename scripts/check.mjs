// 식단 검사기: 매운 재료, 14일 반복, 🙅 메뉴, 형식 오류를 찾는다.
// 사용: node scripts/check.mjs plan.json   |   node scripts/check.mjs --selftest
import { readFileSync } from "node:fs";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const CATS = ["채소", "육류·해산물", "유제품", "가공식품", "양념"];
const MEALS = ["breakfast", "lunch", "dinner"];
// 안 매운 버전으로 허용하는 이름(공백 제거 후 비교). 이 표현을 지운 뒤 금지어를 찾는다.
const ALLOWED = /(백|하얀|간장|궁중)(김치|떡볶이|짬뽕|제육볶음|제육|닭갈비|닭볶음탕|비빔밥|비빔국수|비빔|무생채)/g;
const BANNED = ["고추", "고춧", "청양", "땡초", "할라피뇨", "스리라차", "핫소스", "타바스코", "칠리", "마라탕", "마라샹궈",
  "매운", "매콤", "얼큰", "불닭", "김치", "깍두기", "소박이", "떡볶이", "짬뽕", "제육", "닭갈비", "닭볶음탕", "육개장",
  "비빔", "무생채", "양념치킨", "쫄면", "와사비", "고추냉이", "겨자", "spicy", "chili", "hotsauce", "sriracha"];

const norm = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();
export const spicyWords = (text) => { const t = norm(text).replace(ALLOWED, "").replace(/떡볶이떡/g, ""); /* 떡 이름일 뿐 */ return BANNED.filter((w) => t.includes(w)); };
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// history: { plans: [plan...], logs: [{date, menu, rating, writer}] } — 이번 주 이전 기록
export function check(plan, history = { plans: [], logs: [] }) {
  const errs = [];
  const err = (m) => errs.push(m);
  if (new Date(plan.weekStart + "T00:00:00Z").getUTCDay() !== 6) err(`weekStart ${plan.weekStart} 가 토요일이 아님`);
  if (plan.days?.length !== 7) err("days 가 7일이 아님");
  const weekEnd = addDays(plan.weekStart, 6);

  const scan = (where, text) => { const w = spicyWords(text); if (w.length) err(`🌶️ ${where}: "${text}" 에 금지어 ${w.join(",")}`); };
  const bad = new Set(history.logs.filter((l) => l.rating === "bad").map((l) => norm(l.menu)));
  const recent = []; // {date, name}
  for (const p of history.plans) for (const d of p.days || []) for (const k of MEALS) if (d[k]?.name) recent.push({ date: d.date, name: norm(d[k].name) });
  for (const l of history.logs) recent.push({ date: l.date, name: norm(l.menu) });
  const seen = new Map();

  (plan.days || []).forEach((d, i) => {
    if (d.date !== addDays(plan.weekStart, i)) err(`days[${i}].date ${d.date} 가 순서에 맞지 않음`);
    for (const k of MEALS) {
      const m = d[k], at = `${d.date} ${k}`;
      if (!m?.name) { err(`${at}: 메뉴 없음`); continue; }
      if (!/^https:\/\//.test(m.recipeUrl || "")) err(`${at}: recipeUrl 없음`);
      if (!Array.isArray(m.ingredients) || !m.ingredients.length) err(`${at}: ingredients 없음`);
      const alts = m.alternatives || [];
      if (alts.length < 2 || alts.length > 3) err(`${at}: 대체 메뉴는 2~3개`);
      if ((m.sides || []).length > 2) err(`${at}: 반찬은 0~2개`);
      // note 는 "고춧가루는 빼세요" 같은 안내를 담으므로 검사하지 않는다.
      scan(at, m.name);
      m.ingredients?.forEach((x) => scan(`${at} 재료`, x));
      for (const s of m.sides || []) { scan(`${at} 반찬`, s.name); s.ingredients?.forEach((x) => scan(`${at} 반찬 재료`, x)); }
      for (const a of alts) {
        scan(`${at} 대체`, a.name); a.ingredients?.forEach((x) => scan(`${at} 대체 재료`, x));
        if (bad.has(norm(a.name))) err(`${at}: 대체 메뉴 "${a.name}" 는 🙅 받은 메뉴`);
      }
      const n = norm(m.name);
      if (bad.has(n)) err(`${at}: "${m.name}" 는 🙅 받은 메뉴`);
      if (seen.has(n)) err(`${at}: "${m.name}" 가 이번 주 ${seen.get(n)} 와 겹침`);
      seen.set(n, at);
      const hit = recent.find((r) => r.name === n && r.date < d.date && r.date >= addDays(d.date, -14));
      if (hit) err(`${at}: "${m.name}" 를 ${hit.date} 에 먹음 (14일 이내 반복)`);
    }
  });

  const ids = new Set();
  for (const it of plan.shopping || []) {
    if (!it.id || ids.has(it.id)) err(`장보기 id 중복/없음: ${it.name}`);
    ids.add(it.id);
    if (!CATS.includes(it.category)) err(`장보기 "${it.name}" 카테고리 "${it.category}" 가 ${CATS.join("/")} 중 하나가 아님`);
    if (it.neededBy && (it.neededBy < plan.weekStart || it.neededBy > weekEnd)) err(`장보기 "${it.name}" neededBy 가 이번 주 밖`);
    scan("장보기", it.name);
  }
  if (!(plan.shopping || []).length) err("장보기 목록이 비어 있음");
  return errs;
}

function selftest() {
  assert.deepEqual(spicyWords("간장 떡볶이"), []);
  assert.deepEqual(spicyWords("백김치"), []);
  assert.deepEqual(spicyWords("떡볶이떡 600g"), []);
  assert.deepEqual(spicyWords("하얀 짬뽕"), []);
  assert.deepEqual(spicyWords("후추 약간"), []);
  assert.deepEqual(spicyWords("파프리카 1개"), []);
  assert.ok(spicyWords("고춧가루 1큰술").length);
  assert.ok(spicyWords("꽈리고추 멸치볶음").length);
  assert.ok(spicyWords("배추김치").length);
  assert.ok(spicyWords("떡볶이").length);
  assert.ok(spicyWords("청양고추 1개").length);
  assert.ok(spicyWords("돼지고기 고추장 볶음").length);
  const meal = (name) => ({ name, recipeUrl: "https://x", ingredients: ["a"], alternatives: [{ name: name + "A" }, { name: name + "B" }] });
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays("2026-11-21", i), breakfast: meal("아" + i), lunch: meal("점" + i), dinner: meal("저" + i) }));
  const plan = { weekStart: "2026-11-21", days, shopping: [{ id: "a", name: "양파", category: "채소", neededBy: "2026-11-21" }] };
  assert.deepEqual(check(plan), []);
  assert.equal(check(plan, { plans: [], logs: [{ date: "2026-11-15", menu: "저0", rating: "good" }] }).length, 1); // 14일 반복
  assert.equal(check(plan, { plans: [], logs: [{ date: "2026-10-01", menu: "저0", rating: "bad" }] }).length, 1); // 🙅
  days[1].dinner.name = "김치찌개";
  assert.ok(check(plan).some((e) => e.startsWith("🌶️")));
  console.log("selftest ok");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] === "--selftest") selftest();
  else {
    const errs = check(JSON.parse(readFileSync(process.argv[2], "utf8")));
    console.log(errs.length ? errs.join("\n") : "검사 통과 (매운 재료 0건)");
    process.exit(errs.length ? 1 : 0);
  }
}

// Firestore REST 도구 (의존성 없음). 가족 코드는 환경변수 FAMILY_CODE 또는 .env 에서 읽는다.
//   node scripts/fs.mjs init            가족 코드가 없으면 만들어 .env 에 저장하고 기본 설정 문서를 만든다
//   node scripts/fs.mjs dump [토요일]   식단 짜기에 필요한 자료(설정, 최근 42일 기록, 지난 식단, 이번/다음 주 시작일)를 JSON 으로 출력
//   node scripts/fs.mjs put plan.json   검사 통과 시 plans/{weekStart} 에 저장 (그 주 문서를 통째로 덮어씀)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { firebaseConfig } from "../config.js";
import { check } from "./check.mjs";

if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^(\w+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const KEY = `key=${firebaseConfig.apiKey}`;

const enc = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const dec = (v) => {
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("integerValue" in v) return Number(v.integerValue);
  if ("nullValue" in v) return null;
  return Object.values(v)[0]; // string, boolean, double, timestamp
};

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/${path}${path.includes("?") ? "&" : "?"}${KEY}`, { ...opts, headers: { "content-type": "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${await res.text()}`);
  return res.json();
}
const fam = () => {
  const c = process.env.FAMILY_CODE;
  if (!c) throw new Error("FAMILY_CODE 가 없습니다 (.env 또는 환경변수)");
  return `families/${c}`;
};
const getDoc = async (p) => { const d = await api(`${fam()}/${p}`); return d ? dec({ mapValue: d }) : null; };
const putDoc = (p, obj) => api(`${fam()}/${p}`, { method: "PATCH", body: JSON.stringify({ fields: enc(obj).mapValue.fields }) });

const todayKST = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekStartOf = (s) => addDays(s, -((new Date(s + "T00:00:00Z").getUTCDay() + 1) % 7));

async function logsSince(date) {
  const rows = await api(`${fam()}:runQuery`, { method: "POST", body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: "logs" }],
    where: { fieldFilter: { field: { fieldPath: "date" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: date } } },
  } }) });
  return rows.filter((r) => r.document).map((r) => { const { createdAt, ...rest } = dec({ mapValue: r.document }); return rest; });
}

async function history(weekStart) {
  const prev = await Promise.all([1, 2, 3].map((n) => getDoc(`plans/${addDays(weekStart, -7 * n)}`)));
  const plans = prev.filter(Boolean).map(({ checked, ...p }) => p);
  return { plans, logs: await logsSince(addDays(weekStart, -42)) };
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "init") {
  if (!process.env.FAMILY_CODE) {
    process.env.FAMILY_CODE = randomBytes(18).toString("base64url");
    writeFileSync(".env", `FAMILY_CODE=${process.env.FAMILY_CODE}\n`, { flag: "a" });
    console.log("새 가족 코드를 .env 에 저장했습니다");
  }
  if (!(await getDoc("settings/main"))) {
    await putDoc("settings/main", { members: [{ name: "아빠", age: 45 }, { name: "엄마", age: 45 }, { name: "아들", age: 12 }, { name: "딸", age: null }],
      noSpicy: true, allergies: "", dislikes: "", likes: "", cookTime: "아침 15분 이내, 평일 저녁 30분 이내, 주말은 여유" });
    console.log("기본 설정 문서를 만들었습니다");
  }
  console.log("OK");
} else if (cmd === "dump") {
  const thisWeek = weekStartOf(todayKST());
  // 토요일 실행이면 오늘 시작하는 주, 그 외엔 이번 주가 비었으면 이번 주 / 있으면 다음 주를 짠다.
  // 인자로 주 시작일(토요일)을 주면 그 주를 다시 짠다.
  const target = arg || ((await getDoc(`plans/${thisWeek}`)) ? addDays(thisWeek, 7) : thisWeek);
  const h = await history(target);
  console.log(JSON.stringify({ today: todayKST(), targetWeekStart: target, settings: await getDoc("settings/main"), ...h }, null, 1));
} else if (cmd === "put") {
  const plan = JSON.parse(readFileSync(arg, "utf8"));
  const errs = check(plan, await history(plan.weekStart));
  if (errs.length) { console.error("검사 실패, 저장하지 않았습니다:\n" + errs.join("\n")); process.exit(1); }
  await putDoc(`plans/${plan.weekStart}`, { ...plan, swaps: {}, checked: {}, createdAt: new Date().toISOString() });
  console.log(`저장 완료: plans/${plan.weekStart} (매운 재료 0건, 14일 반복 0건)`);
} else {
  console.log("사용: node scripts/fs.mjs init | dump | put plan.json");
  process.exit(1);
}

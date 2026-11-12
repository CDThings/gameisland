import fs from "node:fs";

const token = process.env.TK;
if (!token) { console.log("TK 未设"); process.exit(1); }
const H = { Authorization: "Bearer " + token, "Accept": "application/vnd.github+json", "Content-Type": "application/json" };

async function j(method, url, body) {
  const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: r.status, data };
}

const FORK = "https://api.github.com/repos/mozziechu/dbx-store";

(async () => {
  // 1. fork main 上是否已有两文件
  const f1 = await j("GET", FORK + "/contents/publishers/cando.json?ref=main");
  const f2 = await j("GET", FORK + "/contents/candidates/cando.gameisland.json?ref=main");
  console.log("fork main: publishers/cando.json", f1.status, "| candidates/cando.gameisland.json", f2.status);
  if (f1.status !== 200 || f2.status !== 200) { console.log("前置文件缺失，先补建再开 PR"); process.exit(2); }

  // 2. 专用分支（若不存在则从 main 的 HEAD 建 git ref）
  let b = await j("GET", FORK + "/branches/submit-cando.gameisland");
  if (b.status === 404) {
    const main = await j("GET", FORK + "/branches/main");
    if (main.status !== 200) { console.log("取 main 失败:", JSON.stringify(main.data).slice(0, 200)); process.exit(1); }
    b = await j("POST", FORK + "/git/refs", { ref: "refs/heads/submit-cando.gameisland", sha: main.data.commit.sha });
    console.log("建分支:", b.status, "from main @", main.data.commit.sha.slice(0, 8));
  } else {
    console.log("分支已存在:", b.data && b.data.name, "at", b.data && b.data.commit && b.data.commit.sha);
  }
  if (b.status !== 200 && b.status !== 201) { console.log("分支失败:", JSON.stringify(b.data).slice(0, 300)); process.exit(1); }

  // 3. 开 PR：head = fork 分支 → base = 上游 t8y2/dbx-store:main
  const prBody = fs.readFileSync(new URL("./PR-BODY.md", import.meta.url), "utf8");
  const pr = await j("POST", "https://api.github.com/repos/t8y2/dbx-store/pulls", {
    title: "Add cando.gameisland (游戏岛 Game Island) v0.1.0 plugin candidate",
    head: "mozziechu:submit-cando.gameisland",
    base: "main",
    body: prBody
  });
  if (pr.status === 422) { console.log("422:", JSON.stringify(pr.data).slice(0, 400)); process.exit(1); }
  if (pr.status !== 201 && pr.status !== 200) { console.log("PR 创建失败:", pr.status, JSON.stringify(pr.data).slice(0, 300)); process.exit(1); }
  console.log("PR 已创建:", pr.data.html_url, "#", pr.data.number, "state:", pr.data.state);
  const files = await j("GET", "https://api.github.com/repos/t8y2/dbx-store/pulls/" + pr.data.number + "/files");
  console.log("PR 文件:", (files.data || []).map(f => f.filename + " (" + f.status + ")").join(", "));
})().catch((e) => { console.log("ERR:", e.message); process.exit(1); });

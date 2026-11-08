#!/usr/bin/env node
'use strict';
// 任務檔的頂端欄位與紀錄行只能用這個工具寫；其餘小節（需求原文、基準檢查、
// 影響範圍、## 計畫 vN）可以直接用 Edit 寫，因為 .doit/ 不是敏感目錄。

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const lib = require('../hooks/lib.js');

const HELP = `log.js：doit 任務檔寫入工具

用法：
  node log.js --new <slug> [--set 欄位=值 ...]        建立任務檔與 ACTIVE（自動把 .doit/ 加進 .git/info/exclude）
  node log.js [--set 欄位=值 ...] "[標籤] 文字" ...     追加紀錄行到「## 紀錄」小節、更新頂端欄位
  node log.js --show                                   印出頂端欄位與檔案路徑
  node log.js --close 完成|中止 ["[標籤] 文字"]         結束任務（狀態改為完成／中止）
  node log.js --lessons                                印出專案與全域教訓檔內容
  node log.js --lesson project|global < 內容            把一條教訓（stdin，markdown）追加到專案或全域教訓檔
  node log.js --lesson-bump project|global <編號> [--hit]  既有教訓再犯：犯錯次數 +1（--hit 則遇到次數 +1），「最近」改成今天
  node log.js --help                                   這份說明

教訓檔位置：專案 <repo>/.doit/LESSONS.md；全域 ~/.doit/LESSONS.md（兩者都不在 .claude/ 下，不會被擋）。
寫教訓請用 --lesson 搭配 heredoc，不要直接 Write 全域檔（在專案目錄外會被權限擋下）。
同一個坑再犯用 --lesson-bump（例如 --lesson-bump global G-001），不要手改次數或另建重複條目。

欄位（--set）：
  狀態      探索中 | 待使用者 | 待批准 | 已批准 | 實作中 | 待審查 | 完成 | 中止
  模式      brownfield | greenfield
  等級      低 | 中 | 高
  命中條件  定成這一級的依據（高或中風險條件原文）；低風險寫「無」
  類型      feat | fix | refactor | test | perf | docs | chore
  計畫版本  整數
  批准      無 | v1「使用者原話」
  分支      尚未建立 | <分支名>
  base      base 分支
  起始SHA   git rev-parse HEAD
  下一步    一句話，接續時第一件要做的事（Stop hook 檢查它不能為空）

紀錄行標籤：
  [完成] 步驟 N：…
  [紀錄] …
  [證據 標準N] …        [證據 基準] …（基準檢查無新失敗）
  [錯誤 來源：agent|使用者|環境 分類：需求|實作|工具|環境|流程] …
  [審查 reviewer @<sha>] 結論：…
  [批准 vN] 「原話」
  [升級] 低→中：原因
  [範圍外] …
  [停止] …

紀錄行會自動加上時間戳，並插入「## 紀錄」小節尾端（在 ## 計畫 vN 之前）。
`;

const TAG_RE = /^\[(完成|紀錄|證據 (標準\d+|基準)|錯誤 來源：(agent|使用者|環境) 分類：(需求|實作|工具|環境|流程)|審查 [^\]]+|批准 v\d+|升級|停止|範圍外)\]\s*\S/;

const FIELD_VALIDATORS = {
  '狀態': (v) => lib.ALL_STATUSES.includes(v) || `狀態必須是：${lib.ALL_STATUSES.join('、')}`,
  '等級': (v) => lib.TIERS.includes(v) || `等級必須是：${lib.TIERS.join('、')}`,
  '模式': (v) => ['brownfield', 'greenfield'].includes(v) || '模式必須是 brownfield 或 greenfield',
  '計畫版本': (v) => /^\d+$/.test(v) || '計畫版本必須是整數',
};

const DEFAULT_FIELDS = [
  ['狀態', lib.STATUS.EXPLORING],
  ['模式', 'brownfield'],
  ['等級', '中'],
  ['命中條件', '無'],
  ['類型', ''],
  ['計畫版本', '0'],
  ['批准', '無'],
  ['分支', '尚未建立'],
  ['base', ''],
  ['起始SHA', ''],
  ['下一步', ''],
];

const LOG_HEADING = '## 紀錄';

function die(msg) {
  process.stderr.write(`log.js: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { sets: [], lines: [], new: null, show: false, close: null, help: false, lessons: false, lesson: null, bump: null, hit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') {
      const kv = argv[++i];
      if (!kv || !kv.includes('=')) die('--set 需要 欄位=值');
      const idx = kv.indexOf('=');
      out.sets.push([kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()]);
    } else if (a === '--new') {
      out.new = argv[++i];
      if (!out.new) die('--new 需要 slug');
    } else if (a === '--show') {
      out.show = true;
    } else if (a === '--lessons') {
      out.lessons = true;
    } else if (a === '--lesson') {
      out.lesson = argv[++i];
      if (!['project', 'global'].includes(out.lesson)) die('--lesson 需要 project 或 global');
    } else if (a === '--lesson-bump') {
      const scope = argv[++i];
      const id = argv[++i];
      if (!['project', 'global'].includes(scope)) die('--lesson-bump 需要 project 或 global');
      if (!id || !/^[GP]-\d+$/.test(id)) die('--lesson-bump 需要教訓編號，例如 G-001 或 P-002');
      out.bump = { scope, id };
    } else if (a === '--hit') {
      out.hit = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--close') {
      out.close = argv[++i];
      if (![lib.STATUS.DONE, lib.STATUS.ABORTED].includes(out.close)) die('--close 需要 完成 或 中止');
    } else if (a.startsWith('--')) {
      die(`不認識的選項 ${a}（--help 看用法）`);
    } else {
      out.lines.push(a);
    }
  }
  return out;
}

function ensureExcluded(root) {
  const entry = lib.WF_DIR + '/';
  try {
    const excludePath = execSync('git rev-parse --git-path info/exclude', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    const abs = path.resolve(root, excludePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const cur = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    if (!cur.split(/\r?\n/).some((l) => l.trim() === entry)) {
      fs.writeFileSync(abs, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + entry + '\n');
    }
  } catch {
    // 不是 git repo 或 git 不可用：由 skill 的階段 0 另行處理
  }
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function serialize(fields, bodyLines) {
  const head = ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---'];
  const body = bodyLines.slice();
  while (body.length && body[body.length - 1] === '') body.pop();
  return head.concat(body).join('\n') + '\n';
}

function applySets(fields, sets) {
  for (const [k, v] of sets) {
    const val = FIELD_VALIDATORS[k];
    if (val) {
      const r = val(v);
      if (r !== true) die(`${k}=${v}：${r}`);
    }
    fields[k] = v;
  }
}

// 把新紀錄行插進「## 紀錄」小節尾端（下一個 ## 標題之前），沒有該小節就補在檔尾。
function appendLogLines(bodyLines, newLines) {
  const body = bodyLines.slice();
  let start = body.findIndex((l) => l.trim() === LOG_HEADING);
  if (start === -1) {
    while (body.length && body[body.length - 1] === '') body.pop();
    body.push('', LOG_HEADING);
    start = body.length - 1;
  }
  let end = body.length;
  for (let i = start + 1; i < body.length; i++) {
    if (/^## /.test(body[i])) { end = i; break; }
  }
  const section = body.slice(start + 1, end);
  while (section.length && section[section.length - 1] === '') section.pop();
  section.push(...newLines);
  const rest = body.slice(end);
  const tail = rest.length ? ['', ...rest] : [];
  return body.slice(0, start + 1).concat(section, tail);
}

function stamp(line) {
  return `[${lib.nowStamp()}] ${line}`;
}

function printLessons(root) {
  const files = [
    ['專案教訓', path.join(lib.wfDir(root), 'LESSONS.md')],
    ['全域教訓', lib.GLOBAL_LESSONS],
  ];
  for (const [label, p] of files) {
    process.stdout.write(`===== ${label}：${p} =====\n`);
    if (fs.existsSync(p)) process.stdout.write(fs.readFileSync(p, 'utf8').trimEnd() + '\n');
    else process.stdout.write('（無）\n');
  }
}

function lessonFile(root, scope) {
  return scope === 'global' ? lib.GLOBAL_LESSONS : path.join(lib.wfDir(root), 'LESSONS.md');
}

// 既有教訓再犯：找到「### <編號> 」那一條，次數 +1、「最近」改成今天。
function bumpLesson(root, scope, id, hit) {
  const target = lessonFile(root, scope);
  if (!fs.existsSync(target)) die(`教訓檔不存在：${lib.normalize(target)}`);
  const raw = fs.readFileSync(target, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const headRe = new RegExp(`^###\\s+${id}(\\s|$)`);
  const start = lines.findIndex((l) => headRe.test(l));
  if (start === -1) die(`教訓檔裡沒有 ${id}（${lib.normalize(target)}）`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##/.test(lines[i])) { end = i; break; }
  }
  const field = hit ? '遇到次數' : '犯錯次數';
  const countRe = new RegExp(`^(\\s*-\\s*${field}：)(\\d+)(.*)$`);
  const dateRe = /^(\s*-\s*首次：.*?／\s*最近：)(\d{4}-\d{2}-\d{2})(.*)$/;
  const todayStr = lib.nowStamp().slice(0, 10);
  let counted = false;
  let dated = false;
  for (let i = start + 1; i < end; i++) {
    const c = lines[i].match(countRe);
    if (c && !counted) { lines[i] = `${c[1]}${Number(c[2]) + 1}${c[3]}`; counted = true; continue; }
    const d = lines[i].match(dateRe);
    if (d && !dated) { lines[i] = `${d[1]}${todayStr}${d[3]}`; dated = true; }
  }
  if (!counted) die(`${id} 裡找不到「- ${field}：N」這一行`);
  fs.writeFileSync(target, lines.join(eol));
  process.stdout.write(`已更新 ${id}：${field} +1` + (dated ? `，最近 → ${todayStr}` : '（沒有「首次／最近」行，日期未更新）') + '\n');
}

function appendLesson(root, scope) {
  const target = lessonFile(root, scope);
  let content = '';
  try { content = fs.readFileSync(0, 'utf8'); } catch { /* 沒有 stdin */ }
  content = content.replace(/\r\n/g, '\n').trim();
  if (!content) die('--lesson 需要從 stdin 讀到教訓內容（用 heredoc）');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  let out = existing;
  if (!existing.trim()) out = `# ${scope === 'global' ? '全域' : '專案'}教訓\n`;
  if (!out.endsWith('\n')) out += '\n';
  out += '\n' + content + '\n';
  fs.writeFileSync(target, out);
  process.stdout.write(`已追加到 ${lib.normalize(target)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }

  const root = lib.findProjectRoot(process.cwd());
  if (!root) die(`找不到專案根目錄（沒有 .git 也沒有 ${lib.WF_DIR}/ACTIVE）`);
  const dir = lib.wfDir(root);

  if (args.lessons) { printLessons(root); return; }
  if (args.lesson) { appendLesson(root, args.lesson); return; }
  if (args.bump) { bumpLesson(root, args.bump.scope, args.bump.id, args.hit); return; }

  if (args.new) {
    const slug = args.new.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const name = `${today()}-${slug}.md`;
    const taskPath = path.join(dir, 'tasks', name);
    if (fs.existsSync(taskPath)) die(`任務檔已存在：${name}`);
    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    ensureExcluded(root);

    const fields = Object.fromEntries(DEFAULT_FIELDS);
    applySets(fields, args.sets);
    for (const l of args.lines) if (!TAG_RE.test(l)) die(`紀錄行格式不符：${l}`);
    const body = [
      '',
      '## 需求原文',
      '',
      '## 基準檢查',
      '',
      '## 影響範圍',
      '',
      LOG_HEADING,
      stamp('[紀錄] 任務建立'),
      ...args.lines.map(stamp),
    ];
    fs.writeFileSync(taskPath, serialize(fields, body));
    fs.writeFileSync(path.join(dir, lib.ACTIVE_FILE), name + '\n');
    process.stdout.write(`已建立 ${lib.normalize(path.relative(root, taskPath))}，ACTIVE 已指向它\n`);
    return;
  }

  const task = lib.readActiveTask(root);
  if (!task && args.show) {
    // 階段 0 用 --show 檢查有沒有可接續的任務，「沒有」是正常結果，不算錯誤
    process.stdout.write(`（無進行中任務：${lib.WF_DIR}/ACTIVE 不存在或指向的檔案不存在）\n`);
    return;
  }
  if (!task) die(`沒有進行中的任務（${lib.WF_DIR}/ACTIVE 不存在或指向的檔案不存在）`);

  if (args.show) {
    for (const [k, v] of Object.entries(task.fields)) process.stdout.write(`${k}: ${v}\n`);
    process.stdout.write(`檔案: ${lib.normalize(path.relative(root, task.taskPath))}\n`);
    return;
  }

  if (args.close) args.sets.push(['狀態', args.close]);
  if (!args.sets.length && !args.lines.length) die('沒有要做的事：給 --set 或至少一行紀錄（--help 看用法）');

  const fields = { ...task.fields };
  applySets(fields, args.sets);

  for (const l of args.lines) {
    if (!TAG_RE.test(l)) die(`紀錄行格式不符：${l}\n合法標籤見 --help`);
  }
  const newLines = args.lines.map(stamp);
  for (const [k, v] of args.sets) {
    // 批准不自動留紀錄：階段 4 已要求 agent 手寫 [批准 vN] 「原話」，避免重複兩行
    if (['狀態', '計畫版本', '等級'].includes(k)) newLines.push(stamp(`[紀錄] ${k} → ${v}`));
  }

  const bodyLines = appendLogLines(task.lines.slice(task.headerEnd + 1), newLines);
  fs.writeFileSync(task.taskPath, serialize(fields, bodyLines));
  process.stdout.write(`已更新 ${task.name}` + (args.sets.length ? `（${args.sets.map(([k, v]) => `${k}=${v}`).join(', ')}）` : '') + '\n');
}

main();

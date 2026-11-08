#!/usr/bin/env node
'use strict';
// 任務檔的唯一寫入工具。agent 不手動編輯頂端欄位與紀錄行。
//
// 用法：
//   node log.js --new <slug> [--set 欄位=值 ...]        建立任務檔與 ACTIVE
//   node log.js [--set 欄位=值 ...] "[標籤] 文字" ...     追加紀錄行、更新欄位
//   node log.js --show                                   印出頂端欄位
//   node log.js --close 完成|中止 "[標籤] 文字"           結束任務（狀態改為完成/中止）
//
// 標籤：[完成] [紀錄] [證據 標準N] [錯誤 來源：agent|使用者|環境 分類：需求|實作|工具|環境|流程]
//       [審查 ...] [批准 vN] [升級] [停止] [範圍外]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const lib = require('../hooks/lib.js');

const TAG_RE = /^\[(完成|紀錄|證據 標準\d+|錯誤 來源：(agent|使用者|環境) 分類：(需求|實作|工具|環境|流程)|審查 [^\]]+|批准 v\d+|升級|停止|範圍外)\]\s*\S/;

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

function die(msg) {
  process.stderr.write(`log.js: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { sets: [], lines: [], new: null, show: false, close: null };
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
    } else if (a === '--close') {
      out.close = argv[++i];
      if (![lib.STATUS.DONE, lib.STATUS.ABORTED].includes(out.close)) die('--close 需要 完成 或 中止');
    } else {
      out.lines.push(a);
    }
  }
  return out;
}

function ensureExcluded(root) {
  try {
    const excludePath = execSync('git rev-parse --git-path info/exclude', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    const abs = path.resolve(root, excludePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const cur = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    if (!cur.split(/\r?\n/).some((l) => l.trim() === '.claude/doit/')) {
      fs.writeFileSync(abs, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + '.claude/doit/\n');
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
  return head.concat(bodyLines).join('\n');
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = lib.findProjectRoot(process.cwd());
  if (!root) die('找不到專案根目錄（沒有 .git 也沒有 .claude/doit/ACTIVE）');
  const dir = lib.wfDir(root);

  if (args.new) {
    const slug = args.new.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const name = `${today()}-${slug}.md`;
    const taskPath = path.join(dir, 'tasks', name);
    if (fs.existsSync(taskPath)) die(`任務檔已存在：${name}`);
    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    ensureExcluded(root);

    const fields = Object.fromEntries(DEFAULT_FIELDS);
    applySets(fields, args.sets);
    const body = [
      '',
      '## 需求原文',
      '',
      '## 基準檢查',
      '',
      '## 影響範圍',
      '',
      '## 紀錄',
      `[${lib.nowStamp()}] [紀錄] 任務建立`,
    ];
    for (const l of args.lines) {
      if (!TAG_RE.test(l)) die(`紀錄行格式不符：${l}`);
      body.push(`[${lib.nowStamp()}] ${l}`);
    }
    fs.writeFileSync(taskPath, serialize(fields, body) + '\n');
    fs.writeFileSync(path.join(dir, lib.ACTIVE_FILE), name + '\n');
    process.stdout.write(`已建立 ${path.relative(root, taskPath)}，ACTIVE 已指向它\n`);
    return;
  }

  const task = lib.readActiveTask(root);
  if (!task) die('沒有進行中的任務（.claude/doit/ACTIVE 不存在或指向的檔案不存在）');

  if (args.show) {
    for (const [k, v] of Object.entries(task.fields)) process.stdout.write(`${k}: ${v}\n`);
    process.stdout.write(`檔案: ${path.relative(root, task.taskPath)}\n`);
    return;
  }

  if (args.close) args.sets.push(['狀態', args.close]);
  if (!args.sets.length && !args.lines.length) die('沒有要做的事：給 --set 或至少一行紀錄');

  const fields = { ...task.fields };
  applySets(fields, args.sets);

  const bodyLines = task.lines.slice(task.headerEnd + 1);
  for (const l of args.lines) {
    if (!TAG_RE.test(l)) die(`紀錄行格式不符：${l}\n合法標籤見檔頭說明`);
    bodyLines.push(`[${lib.nowStamp()}] ${l}`);
  }
  for (const [k, v] of args.sets) {
    if (k === '狀態' || k === '計畫版本' || k === '批准' || k === '等級') {
      bodyLines.push(`[${lib.nowStamp()}] [紀錄] ${k} → ${v}`);
    }
  }

  // 去掉尾端多餘空行再補一個換行
  while (bodyLines.length && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();
  fs.writeFileSync(task.taskPath, serialize(fields, bodyLines) + '\n');
  process.stdout.write(`已更新 ${task.name}` + (args.sets.length ? `（${args.sets.map(([k, v]) => `${k}=${v}`).join(', ')}）` : '') + '\n');
}

main();

#!/usr/bin/env node
'use strict';
// PreToolUse (Bash|PowerShell)
// 硬規則 2：完成門檻未過，不得做交付 commit；只允許 wip: 前綴的檢查點 commit。
// 任務未完成時不得 git push / git merge。
//
// 判斷 git 子指令時先把 heredoc 內文與引號字串去掉，避免 commit 訊息或
// log.js 的紀錄文字裡出現「push」「merge」「commit」就被誤擋。

const lib = require('./lib.js');

const input = lib.readStdinJson();
const cmd = String((input.tool_input || {}).command || '');
if (!cmd) lib.allow();

const bare = lib.stripShellLiterals(cmd);
// 找出每個 git 指令的子指令：git 之後第一個不是選項的字（-C、-c 會多吃一個參數）。
// 只比對子指令本身，分支名或參數裡的 push／merge／commit（例如 git switch -c fix/push-id）不算。
function gitCalls(s) {
  const calls = [];
  // 前面不能是字元、點、連字號（排除 .git、my-git）；後面不能接路徑或字元（排除 .git/config、github）
  for (const m of s.matchAll(/(?<![\w.-])git(?:\.exe)?(?![\w./-])([^|&;\n]*)/g)) {
    const toks = m[1].trim().split(/\s+/).filter(Boolean);
    let sub = '';
    for (let i = 0; i < toks.length; i++) {
      if (toks[i] === '-C' || toks[i] === '-c') { i++; continue; }
      if (toks[i].startsWith('-')) continue;
      sub = toks[i];
      break;
    }
    calls.push({ sub, index: m.index });
  }
  return calls;
}
const calls = gitCalls(bare);
const commits = calls.filter((c) => c.sub === 'commit');
const isGitCommit = commits.length > 0;
const isGitPush = calls.some((c) => c.sub === 'push');
const isGitMerge = calls.some((c) => c.sub === 'merge');
if (!isGitCommit && !isGitPush && !isGitMerge) lib.allow();

const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const root = lib.findProjectRoot(cwd);
const task = lib.readActiveTask(root);
if (lib.isClosed(task)) lib.allow();

const status = task.fields['狀態'] || '';

if (isGitPush || isGitMerge) {
  lib.denyPreToolUse(
    `[doit] 任務 ${task.name} 狀態為「${status}」，尚未完成，不得 git push / merge。完成門檻通過並把狀態改為「完成」後才可以。`
  );
}

// 檢查點 commit 的判定要看原始指令（wip: 在引號裡）：
// -m "wip: ..."、-m 'wip: ...'、或 heredoc 第一行 wip:
// 每個 git commit 各自切一段（位置取自去皮後的指令，訊息裡的「git commit」不算），
// 每段只看第一個訊息旗標（-m、-am、--message），後面再接 -m "wip: …" 不算。全部是 wip 才放行。
function segIsWip(seg) {
  const msg = seg.match(/\s(?:-[a-zA-Z]*m|--message)[\s=]*["']?\s*(\S*)/);
  const heredocWip = /<<-?\s*["']?\w+["']?[^\n]*\r?\n\s*wip:/i.test(seg);
  return msg ? /^wip:/i.test(msg[1]) || (msg[1].startsWith('$(') && heredocWip) : heredocWip;
}
const isWip = commits.every((m, i) => segIsWip(cmd.slice(m.index, commits[i + 1] ? commits[i + 1].index : undefined)));

if (isWip) {
  if (lib.LOCKED_STATUSES.includes(status)) {
    lib.denyPreToolUse(`[doit] 計畫尚未批准（狀態「${status}」），不得 commit。`);
  }
  lib.allow();
}

lib.denyPreToolUse(
  `[doit] 任務 ${task.name} 狀態為「${status}」，完成門檻尚未通過，不得做交付 commit。` +
  `中途存檔請用 wip: 前綴（例如 git commit -m "wip: 步驟 2 完成"）；交付 commit 要等所有驗收標準有證據、審查無 blocker/major、狀態改為「完成」之後。`
);

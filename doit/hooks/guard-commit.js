#!/usr/bin/env node
'use strict';
// PreToolUse (Bash|PowerShell)
// 硬規則 2：完成門檻未過，不得做交付 commit；只允許 wip: 前綴的檢查點 commit。
// 任務未完成時不得 git push / git merge。

const lib = require('./lib.js');

const input = lib.readStdinJson();
const cmd = String((input.tool_input || {}).command || '');
if (!cmd) lib.allow();

const isGitCommit = /\bgit\b[^|&;\n]*\bcommit\b/.test(cmd);
const isGitPush = /\bgit\b[^|&;\n]*\bpush\b/.test(cmd);
const isGitMerge = /\bgit\b[^|&;\n]*\bmerge(?!-)\b/.test(cmd);
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

// 檢查點 commit：-m "wip: ..."、-m 'wip: ...'、或 heredoc 第一行 wip:
const isWip =
  /-m\s*["']?\s*wip:/i.test(cmd) ||
  /<<\s*-?\s*["']?\w+["']?\s*\r?\n\s*wip:/i.test(cmd);

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

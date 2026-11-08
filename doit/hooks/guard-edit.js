#!/usr/bin/env node
'use strict';
// PreToolUse (Edit|Write|MultiEdit|NotebookEdit)
// 硬規則 1：任務計畫未批准前，不得修改 .claude/doit/ 以外的檔案。
// 例外：無人看管模式且等級為低（v0.3 才啟用，先保留判斷）。

const lib = require('./lib.js');

const input = lib.readStdinJson();
const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const root = lib.findProjectRoot(cwd);
const task = lib.readActiveTask(root);

if (lib.isClosed(task)) lib.allow();

const ti = input.tool_input || {};
const filePath = ti.file_path || ti.notebook_path || '';
if (!filePath) lib.allow();
if (lib.isUnderWfDir(root, filePath)) lib.allow();

const status = task.fields['狀態'] || '';
const unattendedLow = task.fields['無人看管'] === '是' && task.fields['等級'] === '低';

if (lib.LOCKED_STATUSES.includes(status) && !unattendedLow) {
  lib.denyPreToolUse(
    `[doit] 任務 ${task.name} 狀態為「${status}」，計畫尚未批准，不得修改專案檔案 ${lib.normalize(filePath)}。` +
    `先取得使用者明確批准，並用 log.js --set 狀態=已批准 更新任務檔。`
  );
}

if (!lib.ALL_STATUSES.includes(status)) {
  lib.denyPreToolUse(`[doit] 任務檔 ${task.name} 的「狀態」欄位值「${status}」不合法，請先用 log.js 修正。`);
}

lib.allow();

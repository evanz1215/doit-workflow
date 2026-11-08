#!/usr/bin/env node
'use strict';
// Stop
// 硬規則 3：有進行中的任務時，離開前必須更新「下一步」。

const lib = require('./lib.js');

const input = lib.readStdinJson();
// 已經因為 Stop hook 續跑過一次，避免無限迴圈
if (input.stop_hook_active) lib.allow();

const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const root = lib.findProjectRoot(cwd);
const task = lib.readActiveTask(root);
if (lib.isClosed(task)) lib.allow();

const next = (task.fields['下一步'] || '').trim();
const status = task.fields['狀態'] || '';

if (!next || next === '無' || next === '-') {
  lib.blockStop(
    `[doit] 任務 ${task.name}（狀態「${status}」）的「下一步」欄位是空的。` +
    `離開前請用 node log.js --set "下一步=<一句話>" 寫明接續時要做什麼，必要時同時更新「狀態」。`
  );
}

lib.allow();

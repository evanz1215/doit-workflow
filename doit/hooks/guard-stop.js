#!/usr/bin/env node
'use strict';
// Stop
// 硬規則 3：有進行中的任務時，離開前必須更新「下一步」。
// 只在這個 session 用 log.js 寫過任務時才擋（見 sessionTouchedTask）。

const fs = require('fs');
const path = require('path');
const lib = require('./lib.js');

const input = lib.readStdinJson();
// 已經因為 Stop hook 續跑過一次，避免無限迴圈
if (input.stop_hook_active) lib.allow();

const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const root = lib.findProjectRoot(cwd);
const task = lib.readActiveTask(root);
if (lib.isClosed(task)) lib.allow();

// 只擋「這個 session 有動過任務」的情況。一個純問答 session（沒跑過 log.js、沒載入 doit skill）
// 不該被要求替別的 session 填下一步，它也沒有依據可填。
// 判斷方式：對話紀錄的工具指令（"command" 欄位）跑過會寫任務的 log.js（--new、--set、--close 或紀錄行）。
// 唯讀指令（--lessons、--show 等）與文字裡提到的 log.js 不算。讀不到紀錄就維持嚴格。
const WRITES_TASK = /(^|\s)--(new|set|close)(?=[\s=]|$)|\s["']\[/;
function sessionTouchedTask() {
  const tp = input.transcript_path;
  if (!tp) return true;
  let raw;
  try {
    raw = fs.readFileSync(tp, 'utf8');
  } catch {
    return true;
  }
  // 文字內容的引號在 jsonl 裡都被跳脫，未跳脫的 "command":" 只會是工具呼叫的欄位
  for (const m of raw.matchAll(/"command":"((?:[^"\\]|\\.)*)"/g)) {
    let cmd;
    try { cmd = JSON.parse('"' + m[1] + '"'); } catch { continue; }
    if (cmd.includes('log.js') && WRITES_TASK.test(cmd)) return true;
  }
  return false;
}

const next = (task.fields['下一步'] || '').trim();
const status = task.fields['狀態'] || '';

if ((!next || next === '無' || next === '-') && sessionTouchedTask()) {
  const logJs = lib.normalize(path.join(process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..'), 'tools', 'log.js'));
  lib.blockStop(
    `[doit] 任務 ${task.name}（狀態「${status}」）的「下一步」欄位是空的。` +
    `離開前請用 node "${logJs}" --set "下一步=<一句話>" 寫明接續時要做什麼，必要時同時更新「狀態」。`
  );
}

lib.allow();

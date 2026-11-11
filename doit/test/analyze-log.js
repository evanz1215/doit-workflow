'use strict';
// 解析 claude -p --output-format stream-json 的紀錄
// 用法：node doit/test/analyze-log.js <run.jsonl>
// 列出每個工具呼叫、subagent 呼叫（[sub]）、hook 擋下（HOOK DENY）、工具錯誤與最終結果，用來稽核沙盒測試是否照 SKILL.md 走。
// 最後一行統計主流程輸出的階段回報（「### 」加 emoji 開頭的標題）份數與各份的階段 emoji。
// 只適用 claude -p 的 stream-json 紀錄；互動 session 的對話紀錄檔不會完整保存接在工具呼叫前的文字，統計會偏少。
// 再統計兩件審查獨立性的事（都應該是 0）：審查類 prompt 裡出現任務檔／計畫檔路徑的次數、subagent 的工具參數碰到 .doit 的次數。
const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);

let sessionId = null;
const tools = new Map(); // id -> {name, summary}
const events = [];
let result = null;
const stageEmojis = []; // 主流程每份階段回報的階段 emoji，依出現順序
// 「### 」後接一個以上 emoji；有狀態 emoji（❌ ⚠️）在前時，取最後一個（緊貼標題文字的那個）當階段 emoji
const REPORT_RE = /^###\s+((?:\p{Extended_Pictographic}️?\s+)+)/u;
const agentTypes = new Map(); // Agent 工具呼叫的 id -> subagent_type
const promptLeaks = []; // 審查類 prompt 指向 .doit/tasks 或 .doit/plans 的那幾次（記 subagent_type）
const subDoitTouches = []; // subagent 的工具參數出現 .doit 的那幾次（記「subagent_type:工具名」）
const REVIEW_AGENT_RE = /^doit:(plan-critic|verifier|reviewer)$/;
const DOIT_FILE_RE = /\.doit[\\/]+(tasks|plans)/;
const DOIT_DIR_RE = /\.doit(?![\w-])/;

function short(s, n = 160) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

for (const line of lines) {
  let ev;
  try { ev = JSON.parse(line); } catch { continue; }
  if (ev.session_id && !sessionId) sessionId = ev.session_id;
  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    const sub = ev.parent_tool_use_id ? '  [sub] ' : '';
    for (const c of ev.message.content) {
      if (c.type === 'tool_use') {
        const i = c.input || {};
        const summary = i.command || i.file_path || i.pattern || i.description || i.skill || i.subagent_type || JSON.stringify(i);
        tools.set(c.id, { name: c.name, summary });
        events.push(`${sub}TOOL ${c.name}: ${short(summary)}`);
        if (!sub && i.subagent_type) {
          agentTypes.set(c.id, i.subagent_type);
          if (REVIEW_AGENT_RE.test(i.subagent_type) && DOIT_FILE_RE.test(String(i.prompt || ''))) promptLeaks.push(i.subagent_type);
        }
        // 排除用的寫法是刻意避開，不算碰到：glob "!.doit/**"、git pathspec ":(exclude).doit"、":!.doit"、":^.doit"
        if (sub && DOIT_DIR_RE.test(JSON.stringify(i).replace(/(?:!|:\(exclude\)|:\^)[^"\s,\\]*\.doit[^"\s,\\]*/g, ''))) {
          subDoitTouches.push(`${agentTypes.get(ev.parent_tool_use_id) || '?'}:${c.name}`);
        }
      } else if (c.type === 'text' && c.text.trim()) {
        events.push(`${sub}TEXT: ${short(c.text, 240)}`);
        // 只算主流程；result 事件會重複最後一段文字，所以不在 result 裡算
        if (!sub) {
          for (const l of c.text.split(/\r?\n/)) {
            const m = l.match(REPORT_RE);
            if (m) stageEmojis.push(m[1].trim().split(/\s+/).pop());
          }
        }
      }
    }
  }
  if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
    for (const c of ev.message.content) {
      if (c.type === 'tool_result') {
        const text = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join(' ') : String(c.content || '');
        const t = tools.get(c.tool_use_id) || { name: '?' };
        if (/\[doit\]/.test(text)) events.push(`   >> HOOK DENY on ${t.name}: ${short(text, 220)}`);
        else if (c.is_error) events.push(`   >> ERROR on ${t.name}: ${short(text, 220)}`);
      }
    }
  }
  if (ev.type === 'system' && ev.subtype && /hook/i.test(ev.subtype)) {
    events.push(`SYSTEM ${ev.subtype}: ${short(JSON.stringify(ev), 220)}`);
  }
  if (ev.type === 'result') result = ev;
}

console.log(`session_id: ${sessionId}`);
console.log(`events: ${events.length}`);
console.log('----');
for (const e of events) console.log(e);
console.log('----');
if (result) {
  console.log(`result.subtype: ${result.subtype}  turns: ${result.num_turns}  cost_usd: ${result.total_cost_usd}  duration_s: ${Math.round((result.duration_ms || 0) / 1000)}`);
  console.log(`final text: ${short(result.result || '', 1500)}`);
}
console.log(`階段回報：${stageEmojis.length} 份` + (stageEmojis.length ? `（${stageEmojis.join(' ')}）` : ''));
console.log(`審查 prompt 指向任務檔：${promptLeaks.length} 次` + (promptLeaks.length ? `（${promptLeaks.join('、')}）` : ''));
console.log(`subagent 碰到 .doit：${subDoitTouches.length} 次` + (subDoitTouches.length ? `（${subDoitTouches.join('、')}）` : ''));

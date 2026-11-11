---
name: resume
description: 接續 doit 工作流未完成的任務。使用者輸入 /doit:resume 時使用。
disable-model-invocation: true
---

# doit：接續未完成任務

所有回報一律繁體中文（程式碼與指令除外）。

1. 讀 `${CLAUDE_PLUGIN_ROOT}/skills/go/SKILL.md` 全文。主流程、三條硬規則、任務檔寫法都在那裡。Read 被權限擋下時改用 `node "${CLAUDE_PLUGIN_ROOT}/tools/log.js" --ref go` 印出全文；兩種都讀不到就停下，告訴使用者需要的權限，不要憑印象接續。
2. 從它的「接續」一節開始照做。
3. 沒有進行中任務時（`log.js --show` 回「無進行中任務」，或狀態是「完成」「中止」），告訴使用者目前沒有可接續的任務，可以用 `/doit:go <開發指令>` 開新任務。不要自己開新任務。

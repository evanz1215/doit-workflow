---
name: init
description: 設定 doit 工作流在這個專案的行為：完成後要不要 commit、要不要開 PR。使用者輸入 /doit:init 時使用。
argument-hint: [commit=on|off] [pr=on|off]
disable-model-invocation: true
---

# doit：專案設定

回報一律繁體中文。參數：$ARGUMENTS

設定存在專案的 `.doit/config.json`，不進 git。沒有設定檔時用預設值，所以不跑這個指令也能用 `/doit:go`。

| 設定 | 預設 | on | off |
|---|---|---|---|
| `commit` | on | 中風險以上每步做 `wip:` 檢查點 commit，完成後做交付 commit | 不做任何 commit，變更留在工作目錄，完成時列出改了哪些檔案 |
| `pr` | off | 完成後 push 分支並開 PR（需要 remote 與 `gh`；需要 `commit=on`） | 只回報分支名稱，push 與 merge 由使用者自己做 |

## 做法

1. 必須在 git repo 裡。不是就告知並停止。
2. **有參數**（例如 `commit=off`、`pr=on`）：直接執行

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/tools/log.js" --config <參數原樣>
   ```

   失敗時（格式不符、`pr=on` 但 `commit=off`）照錯誤訊息告訴使用者，不要自己改參數重試。
3. **沒有參數**：先執行 `node "${CLAUDE_PLUGIN_ROOT}/tools/log.js" --config` 印出目前設定，然後**用 AskUserQuestion 工具讓使用者點選**，不要只用文字請使用者自己打參數。一次呼叫、兩題：
   - 第 1 題 header `commit`：「完成任務時要不要做 commit？目前是 <目前值>。」選項 `on` 與 `off`，各附上表格裡的說明；目前的值放第一個並在標籤後加「（目前）」。
   - 第 2 題 header `pr`：「完成後要不要 push 並開 PR？目前是 <目前值>。」選項 `on` 與 `off`，寫法同上；`on` 的說明註明需要 commit=on。

   拿到答案後，只把和目前值不同的項目照第 2 步寫入（例如 `--config pr=on`）；都沒變就不寫檔，直接回報。答案是 commit=off 且 pr=on 時不要寫入，告訴使用者這個組合不成立，請他重選。
   - 環境沒有 AskUserQuestion 工具（例如 headless）時，才改用文字列出目前值與可用的參數寫法，請使用者回覆。
4. 回報：

```
⚙️ doit 設定

- **commit**：<on／off>（<一句話：這代表什麼>）
- **pr**：<on／off>（<一句話>）
- **檔案**：.doit/config.json
- **生效**：下一個 /doit:go 任務開始時讀取；進行中的任務在接續（/doit:resume）時重新讀取
```

`pr=on` 時另外檢查一次 `git remote -v` 有沒有 remote，沒有就提醒使用者開 PR 會失敗、完成時只會回報分支。

# doit：依風險分級的開發工作流（Claude Code plugin）

把一個開發指令走完：探索 → 釐清 → 計畫落檔 → 使用者批准 → 實作 → 驗證 → 獨立審查 → commit → 檢討。出錯代價決定關卡數量：低風險走輕流程，中風險加計畫批准、檢查點 commit 與獨立 reviewer，高風險再加送批准前的 plan-critic 計畫審查、每步一個 fresh implementer 實作、實跑的 verifier 與瀏覽器 UI 實測。

三條硬規則由 hooks 強制，不靠 agent 自覺：計畫未批准不得改專案檔；完成門檻未過不得做交付 commit、push、merge；離開前必須寫明下一步。

## 安裝

```
/plugin install doit --marketplace evanz1215/doit-workflow
```

或在終端機：`claude plugin marketplace add evanz1215/doit-workflow` 再 `claude plugin install doit@doit-workflows`。

## 使用

```
/doit:go <開發指令>   新任務
/doit:ask <問題>      唯讀回答，不改檔、不建任務
/doit:resume         接續未完成任務
/doit:status         看狀態
/doit:abort [原因]   中止（會先確認）
/doit:init           設定：commit=on|off（預設 on）、pr=on|off（預設 off）
```

任務狀態放在目標專案的 `.doit/`，由 `tools/log.js` 寫入，不進 git。

## 需求

- Node.js（hooks 與 log.js 用 node 執行）
- 目標專案必須是 git repo

## 測試

### 單元測試（hooks 與 log.js）

```
node doit/test/run-tests.js
```

用假的 hook 事件跑每個 hook 與 log.js，確認擋／放行為、欄位驗證、標籤格式、教訓檔讀寫。不需要 Claude Code。

### 沙盒測試（整個流程在 headless Claude Code 跑一次）

1. 安裝 plugin（見上）。
2. 準備一個小的 git repo 當沙盒（例如一個有 `npm test` 的 Node 專案，commit 乾淨），放在專案以外的暫存目錄。
3. 在沙盒目錄執行一個任務，紀錄存成 jsonl：

   ```
   claude -p "/doit:go <開發指令>" --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools "Read" "Grep" "Glob" "Edit" "Write" "Agent" "Bash(git:*)" "Bash(npm test:*)" "Bash(node:*)" > run1.jsonl
   ```

   流程走到「待批准」會停下。從 jsonl 取出 `session_id`，再以同一個 session 回覆批准：

   ```
   claude -p --resume <session_id> "確認，照計畫做" --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools "Read" "Grep" "Glob" "Edit" "Write" "Agent" "Bash(git:*)" "Bash(npm test:*)" "Bash(node:*)" > run2.jsonl
   ```

4. 用 `node doit/test/analyze-log.js run2.jsonl` 列出每個工具呼叫、subagent 呼叫、hook 擋下與最終結果，逐階段對照 `skills/go/SKILL.md` 稽核有沒有照流程走（四拍順序、審查 prompt 內容、交付 commit 前有沒有先改狀態）。
5. 壞天氣路徑：加 `--max-turns N` 在實作中途切斷再 `--resume` 測接續；在 wip commit 裡塞一個錯誤再把狀態設回「待審查」測 reviewer 打回；不寫「下一步」就結束測 Stop hook。

注意：headless 模式下，agent 常把中途的階段回報寫進思考區塊，只有一回合結束時（✋ 批准請求、📦 交付、🪞 檢討）才輸出成文字；三輪沙盒測試都是這樣，加規則也沒改善。互動模式（終端機、VS Code）下每個階段都會正常回報。所以 headless 稽核以任務檔的紀錄行為準，`analyze-log.js` 的「階段回報」統計在 headless 會偏少。沙盒測試跑完的教訓可能寫進真正的全域教訓檔 `~/.doit/LESSONS.md`，跑完記得檢查。

另外，headless 模式下 Claude Code 的 Bash 靜態檢查會擋掉複合指令（`&&`、變數、`$?`），這是正常成本，不是 doit 的問題；看到大量 `requires approval` 時先檢查 `--allowedTools` 是否涵蓋專案的 build 與測試指令。

設計文件與市面調查見 repo 根目錄的 `workflow-design.md` 與 `market-workflows-comparison.md`。

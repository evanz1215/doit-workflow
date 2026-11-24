# doit-workflow

自己用的 AI Agent 開發工作流 **doit**。設計依據與市面調查見：

- [market-workflows-comparison.md](market-workflows-comparison.md)：12 種市面工作流的流程與優缺點
- [workflow-design.md](workflow-design.md)：設計稿（分級、階段、無人看管、hooks、演進順序）

## `doit/`：Claude Code plugin（v0.2）

v0.2 範圍：低／中／高風險、brownfield、一般模式、plan-critic／implementer（互不相干的步驟可平行派）／verifier／reviewer、瀏覽器 UI 驗證、hooks 擋改檔與 commit、任務檔、接續。

hooks 防的是流程漂移，不是刻意繞過。剩餘限制：

- 用 Bash 改檔（`sed -i`、重導向）只在實作開始前（分支尚未建立）由 guard-dirty 事後抓到：指令已經執行；確定是 agent 造成的才由 agent 還原，否則列出變更問使用者；實作開始後回到鎖定狀態時用 Bash 改檔抓不到。實作開始前，測試或 build 留下未被 gitignore 的產物也會被 guard-dirty 擋，需要使用者處理或加進 `.git/info/exclude`；任務建立後、實作開始前使用者自己改的檔案也一樣，只要不清掉，之後每次 Bash／PowerShell 呼叫都會再被擋一次。
- `bash -lc` 合寫旗標、pwsh 帶值的選項（如 `-ExecutionPolicy Bypass -Command`）、`cmd /c git`、PowerShell `& git push`／`Start-Process git`、`eval`、腳本檔內呼叫 git、gh 帶值的選項（`gh --repo x pr merge`、`gh -R x pr merge`、`gh pr -R x merge`）、大寫 `GH pr merge` 擋不到。

```
doit/
  .claude-plugin/plugin.json
  skills/go/SKILL.md              主流程（/doit:go）
  skills/go/references/           tiering / plan-format / implement / review / ui-verify / retro
  skills/ask|plan|qa|init|resume|status|abort/  其他指令（/doit:ask、/doit:plan、/doit:qa、/doit:init、/doit:resume、/doit:status、/doit:abort）
  agents/                         plan-critic / implementer / verifier / reviewer 四個 subagent
  hooks/hooks.json                五個 hook 的註冊
  hooks/guard-edit.js             未批准不得改專案檔
  hooks/guard-commit.js           未完成不得交付 commit / push / merge（含 gh pr merge、bash -c 引號內的 git）
  hooks/guard-stop.js             離開前必須填「下一步」（改狀態沒帶下一步會被清空）
  hooks/guard-dirty.js            實作開始前 Bash 指令跑完工作目錄要乾淨
  hooks/session-start.js          有未完成任務時提示
  tools/log.js                    任務檔唯一寫入工具
  test/run-tests.js               hooks 與 log.js 的測試
```

### 安裝

這個 repo 本身是一個 marketplace（`.claude-plugin/marketplace.json`）。

從 GitHub 安裝：

```bash
claude plugin marketplace add evanz1215/doit-workflow
```

或從本機 clone 安裝（開發時用，改檔後 `/reload-plugins` 即生效）：

```bash
claude plugin marketplace add <clone 路徑>
```

```bash
claude plugin install doit@doit-workflows
```

改了 plugin 後，在 session 裡 `/reload-plugins`，或重開 session。

不想裝 marketplace 的話，單次測試可以：

```bash
claude --plugin-dir <clone 路徑>/doit
```

### 使用

| 指令 | 用途 |
|---|---|
| `/doit:go <開發指令>` | 新任務 |
| `/doit:ask <問題>` | 唯讀回答專案相關問題，附來源；不改檔、不建任務 |
| `/doit:plan <需求>` | 把大需求拆成數個任務，寫成 `.doit/plans/` 下的計畫檔，每個任務附可直接貼的 `/doit:go` 指令；只規劃不實作 |
| `/doit:qa <QA 回報>` | 診斷 QA 實測回報的問題：定位、實際重現、根因、修法與驗證方法，附可直接貼的 `/doit:go` 指令；只診斷不修改 |
| `/doit:resume` | 接續未完成任務 |
| `/doit:status` | 看狀態 |
| `/doit:abort [原因]` | 中止（會先確認） |
| `/doit:init [commit=on\|off] [pr=on\|off] [implementer=medium\|high] [implementer_model=…]` | 專案設定：完成後要不要 commit（預設開）、開 PR（預設關）、從哪一級開始派 implementer 實作（預設中風險）、implementer 用的模型（預設跟主 session 相同） |

任務狀態放在目標專案的 `.doit/`，不進 git（`log.js --new` 會自動加進 `.git/info/exclude`）。

### 測試

```bash
node doit/test/run-tests.js
```

```bash
claude plugin validate doit
```

### 演進

| 版本 | 範圍 |
|---|---|
| v0.1 | 低／中風險、brownfield、一般模式、reviewer、hooks、任務檔、接續 |
| v0.2 | 高風險：plan-critic、fresh implementer、verifier、瀏覽器驗證 |
| v0.3 | 無人看管模式與煞車 |
| v0.4 | Greenfield 模式與慣例檔 |
| v0.5 | 檢討自動化、`/doit:status` 強化 |

# DeepGrep — מנוע הקשר חכם ל-Claude Code

> תוסף VS Code מקומי שמאנדקס את קוד המקור שלך לגרף תלויות, מחשב קשר רלוונטי, ומעביר אותו ל-Claude Code דרך פרוטוקול MCP — כדי שה-AI יבין את הארכיטקטורה שלך לפני כל עריכה.

---

## תוכן עניינים

1. [מה זה DeepGrep?](#מה-זה-deepgrep)
2. [מה כלול בפרויקט](#מה-כלול-בפרויקט)
3. [ארכיטקטורה](#ארכיטקטורה)
4. [דרישות מקדימות](#דרישות-מקדימות)
5. [התקנה ובנייה](#התקנה-ובנייה)
6. [הפעלת תוסף VS Code](#הפעלת-תוסף-vs-code)
7. [שימוש עם Claude Code](#שימוש-עם-claude-code)
8. [הגדרות](#הגדרות)
9. [כלי MCP זמינים](#כלי-mcp-זמינים)
10. [Agents מוגדרים מראש](#agents-מוגדרים-מראש)

---

## מה זה DeepGrep?

כשאתה עובד עם Claude Code על בסיס קוד גדול, ה-AI מקבל לרוב הקשר חלקי — קובץ אחד בכל פעם. DeepGrep פותר את זה:

1. **מאנדקס** את כל קבצי המקור שלך לעץ תחביר מופשט (AST) ושומר תלויות ב-SQLite
2. **מפעיל שרת MCP מקומי** שחושף כלים לשאילתות על הגרף
3. **Claude Code מחובר** לשרת ויכול לשאול "מי קורא לפונקציה X?" לפני כל עריכה
4. **מציג** את הגרף בחלונית Cytoscape.js אינטראקטיבית בתוך VS Code
5. **מסמן** אוטומטית את הנודים שהכשילו בבדיקות, ישר מהטרמינל

---

## מה כלול בפרויקט

```
DeepGrep/
├── CLAUDE.md                        # הוראות לסביבת Claude Code
├── .claude/
│   ├── settings.json                # Hooks של Claude Code (PreToolUse / PostToolUse)
│   └── agents/
│       ├── indexer.md               # Sub-agent לפרסור ו-DB
│       ├── graph-analyst.md         # Sub-agent לכלי MCP
│       └── ui.md                    # Sub-agent לממשק הגרפי
├── scripts/
│   ├── pre-tool-use.mjs             # חוסם עריכות מסוכנות ל-DB
│   └── post-tool-use.mjs            # מוסיף קבצים שנערכו לתור אינדוקס
├── packages/
│   ├── extension/                   # תוסף VS Code (TypeScript + esbuild)
│   │   └── src/
│   │       ├── extension.ts         # נקודת כניסה ראשית
│   │       ├── db/GraphDatabase.ts  # כל גישת SQLite
│   │       ├── indexer/             # Tree-sitter → nodes + edges
│   │       ├── mcp/                 # רישום MCP ב-VS Code
│   │       ├── webview/             # לוח Cytoscape + מסרים
│   │       ├── terminal/            # ניתוח stack traces מהטרמינל
│   │       └── hooks/               # ניהול .claude/settings.json
│   ├── webview-ui/                  # React 18 + Cytoscape.js (Vite)
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── components/
│   │       │   ├── GraphView.tsx    # הגרף האינטראקטיבי
│   │       │   ├── StatsPanel.tsx   # דשבורד יעילות
│   │       │   └── NodeDetail.tsx   # פרטי נוד + callers/callees
│   │       └── style.css
│   └── mcp-server/                  # שרת MCP עצמאי (Node.js ESM)
│       └── src/
│           ├── index.ts             # 7 כלי MCP רשומים
│           └── db.ts                # SQLite read-only לשרת
└── .deepgrep/
    └── graph.db                     # מסד הנתונים (נוצר אוטומטית, לא ב-git)
```

### השכבות העיקריות

| שכבה | טכנולוגיה | תפקיד |
|------|-----------|--------|
| **Indexer** | web-tree-sitter (WASM) | מפרסר TypeScript/JS/Python/Go/Rust ל-AST |
| **Graph DB** | better-sqlite3 (WAL) | שומר nodes, edges, agent_memory |
| **MCP Server** | @modelcontextprotocol/sdk | חושף 7 כלים ל-Claude Code |
| **VS Code Extension** | vscode API 1.99+ | רישום MCP, watcher, webview, hooks |
| **Webview** | React 18 + Cytoscape.js fcose | ויזואליזציה אינטראקטיבית של הגרף |
| **Hooks** | Node.js scripts | שומר Claude Code מעריכות מסוכנות |

---

## ארכיטקטורה

```
┌─────────────────────────────────────────────────────────────┐
│  VS Code Extension Host                                      │
│                                                              │
│  TreeSitterIndexer ──► GraphDatabase (SQLite WAL)           │
│         ▲                       │                            │
│  FileWatcher              McpServerProvider                  │
│  PostToolUse Hook    ──► vscode.lm.registerMcp...           │
│                               + writes .mcp.json            │
│  ShellIntegration ──► GraphPanel (Webview)                  │
└─────────────────────────────────────────────────────────────┘
           │ stdio
           ▼
┌──────────────────────────┐      ┌──────────────────────────┐
│  MCP Server (child proc) │ ◄──► │  Claude Code CLI         │
│  7 tools over stdio      │      │  (terminal)              │
└──────────────────────────┘      └──────────────────────────┘
```

**זרימת עבודה:**
1. תוסף VS Code מתחיל → מאנדקס את כל קבצי המקור
2. כל שמירה → hook או watcher מאנדקס מחדש את הקובץ תוך 500ms
3. Claude Code מריץ פקודה → MCP server עונה עם גרף ההקשר
4. Claude Code עורך קובץ → PreToolUse hook בודק אם הפעולה בטוחה
5. בדיקה נכשלת בטרמינל → ShellIntegration מסמן את הנודים השבורים בגרף

---

## דרישות מקדימות

| כלי | גרסה מינימלית | הורדה |
|-----|--------------|--------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| pnpm | 8+ | `npm install -g pnpm` |
| VS Code | 1.99+ | [code.visualstudio.com](https://code.visualstudio.com) |
| Claude Code CLI | עדכני | `npm install -g @anthropic-ai/claude-code` |

---

## התקנה ובנייה

### פקודה אחת — הכל ביחד

```bash
git clone <your-repo-url> DeepGrep
cd DeepGrep
pnpm setup
```

זה מריץ באופן אוטומטי:
1. `pnpm install` — מתקין את כל התלויות
2. `node scripts/copy-grammars.mjs` — מעתיק קבצי `.wasm` של Tree-sitter (הפרסר שמבין TypeScript/Python/Go וכו׳) לתוך התוסף
3. `pnpm build` — מקמפל את שרת MCP, ממשק React, והתוסף עצמו

> **אם הבנייה הצליחה** — תראה תיקיית `packages/extension/dist/` עם `extension.js`. זה אומר שהתוסף מוכן להפעלה.

### אם VS Code מתרסק עם שגיאת SQLite (נדיר)

`better-sqlite3` הוא מודול נייטיב שצריך להיות מקומפל מול הגרסה המדויקת של Electron שב-VS Code שלך. ברוב המקרים זה עובד אוטומטית. אם תראה שגיאה כמו `Error: The module was compiled against a different Node.js version`, הרץ:

```bash
cd packages/extension
npx @electron/rebuild -v $(node -e "require('electron/package.json') && process.versions.electron || '32.0.0'") -m .
```

---

## הפעלת תוסף VS Code

### שיטה א׳ — פיתוח (לבדיקה, ללא התקנה) — מומלץ להתחיל מכאן

זו הדרך הכי מהירה לבדוק שהתוסף עובד, ללא התקנה קבועה.

1. פתח את תיקיית **השורש** של הפרויקט ב-VS Code:
   ```bash
   code /path/to/DeepGrep
   ```
   > חשוב: פתח את תיקיית `DeepGrep` עצמה, לא תת-תיקייה.

2. עבור לפאנל **Run and Debug** בסרגל הצד השמאלי (האייקון של הבאג + משולש הפעלה), או לחץ `Cmd+Shift+D` (Mac).

3. בראש הפאנל תראה תפריט נפתח עם **"Launch DeepGrep Extension"** — לחץ על **▶ כפתור הירוק** לצדו.
   - **F5 גם עובד** לאחר שבחרת את הקונפיגורציה (על Mac ייתכן שתצטרך `Fn+F5`).

4. VS Code יפתח **חלון חדש** — זה ה-"Extension Development Host". DeepGrep כבר פועל בו.

5. **בחלון החדש** (לא בחלון הנוכחי שלך): לחץ `Cmd+Shift+P` → הקלד **DeepGrep: Open Dependency Graph** → Enter.
   - אם הכל עבד — תראה חלונית גרף עם הנודים של הפרויקט שנפתח בחלון החדש.

> אם הגרף ריק — לחץ `Cmd+Shift+P` → **DeepGrep: Re-index Workspace** ולחכה שניות ספורות.

---

### שיטה ב׳ — התקנה קבועה (.vsix)

אם רוצים שה-DeepGrep יהיה מותקן תמיד ב-VS Code שלך (לא רק בסשן פיתוח):

```bash
# בנה קובץ .vsix (מבצע גם pnpm setup אם טרם עשית)
pnpm package
```

נוצר קובץ `packages/extension/deepgrep-extension-0.1.0.vsix`.

**התקנה:**
```bash
code --install-extension packages/extension/deepgrep-extension-0.1.0.vsix
```

לאחר מכן פתח VS Code מחדש — התוסף יופעל אוטומטית בכל פרויקט.

---

## שימוש עם Claude Code

### אוטומטי (VS Code + Claude Code בטרמינל משולב)

כשהתוסף פועל ב-VS Code, הוא:
1. רושם את שרת MCP ב-`vscode.lm.registerMcpServerDefinitionProvider`
2. כותב `.mcp.json` לשורש הפרויקט

Claude Code שרץ בטרמינל המשולב של VS Code מגלה את השרת אוטומטית.

### ידני (Claude Code מחוץ ל-VS Code)

אם אתה מריץ Claude Code מחוץ ל-VS Code, ה-`.mcp.json` נוצר אוטומטית. בדוק שהוא קיים:

```bash
cat .mcp.json
```

אמור להיראות כך:
```json
{
  "mcpServers": {
    "deepgrep": {
      "command": "node",
      "args": ["/path/to/packages/extension/dist/mcp-server.js"],
      "env": {
        "DEEPGREP_DB_PATH": "/path/to/.deepgrep/graph.db",
        "DEEPGREP_WORKSPACE": "/path/to/project"
      }
    }
  }
}
```

### אינדוקס ידני

```
Ctrl+Shift+P → DeepGrep: Re-index Workspace
```

מציג התקדמות בחלונית הגרף ובסטטוס בר.

### פתיחת הגרף

```
Ctrl+Shift+P → DeepGrep: Open Dependency Graph
```

- **לחיצה על נוד** → פותח את הקובץ בשורה המתאימה + מציג callers/callees בפאנל הצד
- **טאב Stats** → רואים כמה טוקנים נחסכו, כמה שאילתות MCP בוצעו
- **כפתור Re-index** → אינדוקס מחדש מהממשק

---

## הגדרות

ב-VS Code: `Ctrl+,` → חפש **DeepGrep**

| הגדרה | ברירת מחדל | תיאור |
|-------|-----------|--------|
| `deepgrep.tokenBudget` | `4000` | מקסימום טוקנים לתגובת MCP אחת |
| `deepgrep.indexOnSave` | `true` | אינדוקס אוטומטי בכל שמירה |
| `deepgrep.includedLanguages` | TS, JS, Python, Go, Rust | שפות לאינדוקס |
| `deepgrep.excludePatterns` | `node_modules`, `dist`, `.git` | גלובים לדילוג |
| `deepgrep.mcpServerPort` | `7340` | פורט ל-HTTP-SSE (stdio תמיד זמין) |

---

## כלי MCP זמינים

ברגע שהשרת פועל, Claude Code יכול לקרוא לכלים הבאים:

| כלי | מה הוא עושה |
|-----|------------|
| `mcp__deepgrep__get_dependency_chain` | שרשרת תלויות טרנזיטיבית מלאה עבור סמל |
| `mcp__deepgrep__find_related_nodes` | כל הנודים בטווח N קפיצות מקובץ/סמל |
| `mcp__deepgrep__get_context_for_symbol` | קטע קוד + מי קורא + מה נקרא |
| `mcp__deepgrep__search_graph` | חיפוש fuzzy לפי שם בכל האינדקס |
| `mcp__deepgrep__get_agent_memory` | קריאת זיכרון מתמיד של agent |
| `mcp__deepgrep__set_agent_memory` | כתיבת זיכרון קשור לנוד AST |
| `mcp__deepgrep__get_stats` | סטטיסטיקות האינדקס וחיסכון בטוקנים |

**דוגמה לשימוש ב-Claude Code:**
```
אני רוצה לשנות את הפונקציה processOrder.
תוכל לברר קודם מי קורא לה ומה היא קוראת?
```
Claude Code יפעיל `get_context_for_symbol` ויקבל מפה מדויקת לפני הכתיבה.

---

## Agents מוגדרים מראש

בתיקיית `.claude/agents/` מוגדרים שלושה sub-agents עם פילטרי domain:

| Agent | Domain | שימוש |
|-------|--------|--------|
| `indexer` | `src/indexer/`, `src/db/` | שינויים בפרסור AST ובסכמת SQLite |
| `graph-analyst` | `mcp-server/`, `src/mcp/` | כוונון כלי MCP ופילטרי AIP |
| `ui` | `webview-ui/`, `src/webview/` | שינויים בגרף Cytoscape ובדשבורד |

כל agent קורא ל-`get_context_for_symbol` לפני כל עריכה ושומר זיכרון ב-`.claude/agent-memory/<name>/`.

---

## Hooks של Claude Code

שני scripts רצים אוטומטית עם כל עריכה של Claude Code:

**Pre-edit (חוסם):**
- עריכה ישירה של `graph.db` → חסום
- SQL עם `DROP TABLE` / `DELETE FROM nodes` → חסום
- שינוי סכמה ב-`GraphDatabase.ts` בלי migration → אזהרה/חסום

**Post-edit (אינדוקס):**
- מוסיף את הקובץ שנערך לתור `.deepgrep/reindex-queue.json`
- התוסף מאנדקס מחדש תוך 500ms

---

*בנוי עם TypeScript, React, Cytoscape.js, web-tree-sitter, better-sqlite3, ו-@modelcontextprotocol/sdk*

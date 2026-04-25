# מדריך בנייה, התקנה ופרסום — DeepGrep

> מדריך מלא בעברית: איך ה-CI בונה את התוסף, איך מתקינים אותו על VS Code בכל מחשב, ואיך מפרסמים אותו ב-VS Code Marketplace.

---

## תוכן עניינים

1. [איך תהליך ה-CI עובד](#1-איך-תהליך-ה-ci-עובד)
2. [הרצה ידנית של ה-Workflow](#2-הרצה-ידנית-של-ה-workflow)
3. [הורדת ה-VSIX מ-GitHub Release](#3-הורדת-ה-vsix-מ-github-release)
4. [התקנה על VS Code — מחשב חדש / פרויקט אחר](#4-התקנה-על-vs-code--מחשב-חדש--פרויקט-אחר)
5. [הגדרת MCP לפרויקט שלך](#5-הגדרת-mcp-לפרויקט-שלך)
6. [בנייה מקומית (ללא CI)](#6-בנייה-מקומית-ללא-ci)
7. [בונוס: פרסום ב-VS Code Marketplace](#7-בונוס-פרסום-ב-vs-code-marketplace)

---

## 1. איך תהליך ה-CI עובד

קובץ ה-Workflow נמצא ב-[`.github/workflows/release.yml`](../.github/workflows/release.yml).
הוא מופעל אוטומטית בכל פעם שדוחפים **Git tag** בפורמט `v*.*.*` (למשל `v0.2.0`), ואפשר גם להפעיל אותו ידנית.

### שלבי ה-Workflow בפירוט

```
Checkout  →  pnpm install  →  Rust build  →  Electron detection
    →  better-sqlite3 rebuild  →  pnpm build  →  vsce package  →  GitHub Release
```

| שלב | מה קורה | למה חשוב |
|-----|----------|-----------|
| **Checkout** | מוריד את הקוד מ-GitHub | - |
| **Setup pnpm / Node 22** | מתקין את סביבת Node.js | DeepGrep דורש Node ≥ 22 |
| **Setup Rust** | מוריד toolchain עדכני | הגרף נבנה ב-Rust |
| **Cache Rust** | שומר קבצי בינארי בין ריצות | חוסך 2-3 דקות build |
| **pnpm install** | מתקין את כל תלויות ה-JS | `--frozen-lockfile` מבטיח גרסאות זהות |
| **cargo build --release** | בונה את ה-indexer הרסטי | אופטימיזציה מרבית |
| **Detect Electron version** | מוריד מ-VS Code update API את גרסת Electron | better-sqlite3 דורש הידור לאותו ABI |
| **Rebuild better-sqlite3** | מהדר את הספריה הנייטיבית לגרסת Electron הנכונה | בלי זה התוסף לא יעלה בVS Code |
| **pnpm build** | בונה extension + webview + mcp-server | מייצר `dist/` |
| **vsce package** | אורז הכל לקובץ `.vsix` | זהו קובץ ההתקנה הסופי |
| **Create GitHub Release** | מעלה את ה-VSIX + קבצים נוספים לגיטהאב | מה שהמשתמש מוריד |

### קבצים שמתפרסמים ב-Release

| קובץ | תיאור |
|------|--------|
| `deepgrep-extension-x.y.z.vsix` | **קובץ ההתקנה הראשי** — זה מה שמתקינים |
| `mcp-server.js` | שרת MCP standalone (Node.js בלבד, ללא VS Code) |
| `deepgrep-indexer-macos` | ה-binary הרסטי (אופציונלי) |

---

## 2. הרצה ידנית של ה-Workflow

לפעמים רוצים לבנות גרסה בלי ליצור Git tag. כך עושים זאת:

1. נכנסים לדף הריפו ב-GitHub.
2. לוחצים על **Actions** בתפריט העליון.
3. בצד שמאל בוחרים **Build & Release**.
4. לוחצים **Run workflow** (כפתור אפור בצד ימין).
5. ממלאים (אופציונלי) שדה `tag` — למשל `v0.2.0-beta`.
6. לוחצים **Run workflow** ירוק.

ה-CI ירוץ על `macos-latest`, יבנה את הכל, וייצור release חדש תחת **Releases** בגיטהאב.

### יצירת release רשמי עם Git tag

```bash
# סוג ה-tag: v<major>.<minor>.<patch>
git tag v0.2.0
git push origin v0.2.0
```

הדחיפה של ה-tag מפעילה את ה-Workflow אוטומטית. Release שנוצר כך **לא יסומן כ-prerelease**.

---

## 3. הורדת ה-VSIX מ-GitHub Release

1. נכנסים לדף הריפו ב-GitHub.
2. בצד ימין לוחצים על **Releases** (או `github.com/<user>/<repo>/releases`).
3. בוחרים את הגרסה הרצויה.
4. תחת **Assets** מורידים את הקובץ `deepgrep-extension-*.vsix`.

---

## 4. התקנה על VS Code — מחשב חדש / פרויקט אחר

יש שתי דרכים:

### דרך A — ממשק גרפי (קל)

1. פותחים VS Code.
2. הולכים ל-**Extensions** (`⇧⌘X` / `Ctrl+Shift+X`).
3. לוחצים על **`···`** (שלוש נקודות) בפינה הימנית עליונה של חלונית ה-Extensions.
4. בוחרים **Install from VSIX…**
5. מנווטים לקובץ ה-`.vsix` שהורדתם ומאשרים.
6. VS Code יבקש לרענן — לוחצים **Reload Window** (או `⌘Shift+P` → `Developer: Reload Window`).

### דרך B — שורת פקודה (מהיר)

```bash
# macOS / Linux
code --install-extension /path/to/deepgrep-extension-0.1.0.vsix

# Windows
code --install-extension "C:\Downloads\deepgrep-extension-0.1.0.vsix"
```

לאחר ההתקנה מאמתים:

```bash
code --list-extensions | grep deepgrep
# אמור להדפיס: deepgrep.deepgrep-extension
```

---

## 5. הגדרת MCP לפרויקט שלך

אחרי שהתוסף מותקן, Claude Code צריך לדעת לתקשר עם שרת ה-MCP שהתוסף מריץ. DeepGrep עושה זאת דרך קובץ `.mcp.json` בשורש הפרויקט.

### יצירת `.mcp.json`

צרו את הקובץ בשורש הפרויקט שאתם רוצים לאנדקס:

```json
{
  "mcpServers": {
    "deepgrep": {
      "command": "node",
      "args": [
        "${userHome}/.vscode/extensions/deepgrep.deepgrep-extension-0.1.0/dist/mcp-server.js"
      ],
      "env": {
        "DEEPGREP_DB": "${workspaceFolder}/.deepgrep/graph.db"
      }
    }
  }
}
```

> **טיפ:** הנתיב אל `dist/mcp-server.js` תלוי בגרסה. בדקו את הנתיב המדויק:
> ```bash
> ls ~/.vscode/extensions/ | grep deepgrep
> ```

### אימות החיבור

ב-Claude Code:
```
/mcp
```
אם `deepgrep` מופיע ברשימה עם `connected` — הכל עובד.

### אינדוקס ראשוני של הפרויקט

פתחו את Command Palette (`⌘Shift+P`) ובחרו:
```
DeepGrep: Re-index Workspace
```

לאחר מספר שניות (בהתאם לגודל הפרויקט) תוכלו לבצע בClaudeCode:
```
mcp__deepgrep__get_stats
```
ולראות כמה nodes ו-edges אונדקסו.

---

## 6. בנייה מקומית (ללא CI)

אם רוצים לבנות את ה-VSIX על המחשב האישי (למשל לצורך פיתוח):

### דרישות מקדימות

- **Node.js 22+** — `node --version`
- **pnpm 9+** — `pnpm --version` (התקנה: `npm i -g pnpm`)
- **Rust stable** — `rustc --version` (התקנה: `curl https://sh.rustup.rs -sSf | sh`)
- **VS Code מותקן** ב-`/Applications/Visual Studio Code.app` (ל-macOS)

### שלבים

```bash
# 1. שכפלו את הריפו
git clone https://github.com/<your-org>/DeepGrep.git
cd DeepGrep

# 2. התקינו תלויות JS
pnpm install

# 3. בנו את Rust
cargo build --release

# 4. הידרו better-sqlite3 לגרסת Electron של VS Code המותקן
pnpm rebuild-native
# או בצורה מפורשת:
# ELECTRON_VERSION=35.0.0 npx @electron/rebuild -v 35.0.0 -w better-sqlite3 -C packages/extension

# 5. בנו את כל החבילות
pnpm build

# 6. ארזו ל-VSIX
pnpm package
# הקובץ ייווצר ב: packages/extension/deepgrep-extension-*.vsix
```

---

## 7. בונוס: פרסום ב-VS Code Marketplace

### שלב א — יצירת Publisher

1. נכנסים ל-[marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).
2. מתחברים עם חשבון Microsoft.
3. לוחצים **Create publisher** ומגדירים:
   - **Publisher ID**: מזהה ייחודי (למשל `mycompany` — ייכנס ל-`package.json`)
   - **Display Name**: שם תצוגה

### שלב ב — עדכון `package.json` של ה-extension

```json
{
  "publisher": "YOUR_PUBLISHER_ID",
  "version": "0.1.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/<your-org>/DeepGrep"
  },
  "icon": "media/icon.png",
  "license": "MIT"
}
```

> **חשוב:** שדה `icon` חייב להיות תמונת PNG בגודל **128×128 פיקסל לפחות**.
> שדה `repository` נדרש ל-Marketplace.

### שלב ג — יצירת Personal Access Token

1. נכנסים ל-[dev.azure.com](https://dev.azure.com) (Azure DevOps).
2. לוחצים על האייקון ⚙️ → **Personal access tokens**.
3. לוחצים **New Token**:
   - **Name**: `vsce-publish`
   - **Organization**: `All accessible organizations`
   - **Expiration**: לפי צורך
   - **Scopes**: `Marketplace → Manage`
4. שומרים את ה-token (מופיע פעם אחת בלבד).

### שלב ד — הוספת ה-Token כ-GitHub Secret

1. ב-GitHub Repo → **Settings** → **Secrets and variables** → **Actions**.
2. לוחצים **New repository secret**:
   - **Name**: `VSCE_PAT`
   - **Value**: ה-token שיצרתם

### שלב ה — עדכון ה-Workflow לפרסום אוטומטי

מוסיפים שלב אחרי יצירת ה-Release ב-[`.github/workflows/release.yml`](../.github/workflows/release.yml):

```yaml
      # ── 12. Publish to VS Code Marketplace ────────────────────────────────────
      - name: Publish to VS Code Marketplace
        # מפרסם רק בטאגים רשמיים (לא בהרצות ידניות ולא ב-dev builds)
        if: startsWith(github.ref, 'refs/tags/v')
        working-directory: packages/extension
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
        run: |
          npx @vscode/vsce publish --pat "$VSCE_PAT" --no-dependencies
```

### שלב ו — פרסום ידני (ללא CI)

```bash
cd packages/extension

# התחברות חד פעמית
npx @vscode/vsce login YOUR_PUBLISHER_ID
# הכניסו את ה-PAT כשישאלו

# פרסום
npx @vscode/vsce publish
```

### טיפים לפרסום מוצלח ב-Marketplace

| נושא | מה לבדוק |
|------|-----------|
| **README** | חייב להכיל תיאור, screenshots, ותיעוד שימוש |
| **CHANGELOG.md** | Marketplace מציג אותו כ-"What's New" |
| **icon** | PNG 128×128 לפחות (מומלץ 256×256) |
| **keywords** | עד 5 מילות מפתח ב-`package.json` |
| **vsce package --pre-release** | לגרסאות beta (מספר גרסה 0.x.x) |
| **semver** | patch (x.x.**1**) = bug fix, minor (x.**1**.0) = feature, major (**1**.0.0) = breaking |

### בדיקת הגרסה לפני פרסום

```bash
# ארזו ובדקו את הנתונים לפני דחיפה
npx @vscode/vsce package
npx @vscode/vsce show YOUR_PUBLISHER_ID.deepgrep-extension
```

---

## סיכום זרימת העבודה

```
קוד מוכן
    ↓
git tag v0.2.0 && git push origin v0.2.0
    ↓
GitHub Actions מופעל (macos-latest)
    ↓
Build: Rust + Node + better-sqlite3 (עם Electron גרסה נכונה)
    ↓
vsce package → deepgrep-extension-0.2.0.vsix
    ↓
GitHub Release (עם VSIX + mcp-server.js + binary)
    ↓  (אם מוגדר VSCE_PAT)
VS Code Marketplace
```

---

*נוצר עבור DeepGrep — מנוע הקשר ל-Claude Code*

<div align="center">

<br/>

```
░█████╗░██╗░░░░░██╗░░░░░██╗░░░██╗███████╗██╗░░░░░░█████╗░░██╗░░░░░░░██╗
██╔══██╗██║░░░░░██║░░░░░╚██╗░██╔╝██╔════╝██║░░░░░██╔══██╗░██║░░██╗░░██║
███████║██║░░░░░██║░░░░░░╚████╔╝░█████╗░░██║░░░░░██║░░██║░╚██╗████╗██╔╝
██╔══██║██║░░░░░██║░░░░░░░╚██╔╝░░██╔══╝░░██║░░░░░██║░░██║░░████╔═████║░
██║░░██║███████╗███████╗░░░██║░░░██║░░░░░███████╗╚█████╔╝░░╚██╔╝░╚██╔╝░
╚═╝░░╚═╝╚══════╝╚══════╝░░░╚═╝░░░╚═╝░░░░░╚══════╝░╚════╝░░░░╚═╝░░░╚═╝░░
```

### AI-Powered Accessibility Remediation IDE

*Stop auditing. Start fixing.*


<br/>

[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Gemini AI](https://img.shields.io/badge/Gemini_2.5_Flash-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![axe-core](https://img.shields.io/badge/axe--core_4.11-663399?style=for-the-badge&logo=deque&logoColor=white)](https://github.com/dequelabs/axe-core)
[![WCAG 2.1 AA](https://img.shields.io/badge/WCAG_2.1_AA-005A9C?style=for-the-badge&logo=w3c&logoColor=white)](https://www.w3.org/WAI/WCAG21/quickref/)

<br/>

</div>

---

## The Problem with Accessibility Tooling Today

Traditional tools like Lighthouse and Axe tell you **what** is broken. They hand you a list of violations, a link to WCAG documentation, and nothing else. From there, it's on you to decode the spec, identify the right ARIA pattern, and manually rewrite the component — often buried inside a large, unfamiliar codebase.

The result? Accessibility becomes an afterthought. Tickets age. Bugs persist.

**AllyFlow changes the workflow entirely.**

---

## What AllyFlow Does

AllyFlow is a full-stack accessibility audit and remediation environment. It doesn't just find violations — it drafts the fix. An AI engine generates semantically correct, WCAG-compliant HTML for each failing node, then presents it inside a professional Monaco diff editor so you can review every change before it touches your codebase.

**Audit → Analyze → Fix → Preview → Export.** In one tool.

---

## ✦ Feature Breakdown

<br/>

**🔍 Headless Axe-Core Auditing**
Puppeteer launches a real browser context, injects axe-core, and runs a full WCAG 2.1 AA audit against any public URL or uploaded HTML file. Violations are returned with impact levels, failing node HTML, and structured fix targets.

**🛡️ Safe DOM Scanning (The Hibernation Method)**
Before scanning, AllyFlow surgically mutates the live DOM — renaming `<script>` tags to `<allyflow-script>` and rewriting `onclick` to `data-af-onclick`. Scripts remain structurally in place but cannot execute. No accidental form submissions. No state mutations. No side effects. The original behaviour is fully restored on export.

**🎯 Sentinel Injection System**
Each fix request tags the target node with a unique `data-af-target` attribute before calling the AI. This makes it possible to locate and replace the exact correct occurrence of a node — even when identical HTML exists elsewhere in the document. The sentinel is stripped before export and never reaches the final file.

**🔎 Fuzzy Node Lookup**
When a previous fix mutates a node's attributes (e.g. `div` → `button`), AllyFlow's fingerprint-based matching engine finds the updated version of the node in the master document rather than failing silently. Fixes remain composable across multiple repair cycles.

**🤖 AI Remediation Engine**
Powered by `gemini-2.5-flash` with automatic fallback to `gemini-1.5-flash` and `gemini-1.5-pro`. Temperature is set to `0.1` for near-deterministic output. Few-shot prompting forces the model to return raw HTML only — no markdown fences, no explanations, no hallucinated document wrappers.

**⚡ Offline Heuristic Fallback**
When Gemini is unavailable or quota is exhausted, a pure JavaScript heuristic engine intercepts every request and applies deterministic structural fixes — `<div role="button">` → `<button>`, missing `aria-label` injection, `outline:none` repair, and more. The workflow never stalls, even offline.

**✅ Best Practices Engine**
A second scan pipeline runs automatically after the axe-core audit and catches violations that WCAG automation misses — targeting motor, cognitive, and screen-reader disability categories:

| Rule | What it catches |
|---|---|
| `semantic-button` | Non-button interactive elements (`<a>`, `<div>`) that should be `<button>` |
| `persistent-label` | Form controls with placeholder-only labelling (disappears on input) |
| `keyboard-trap` | Clickable containers unreachable by keyboard navigation |
| `focus-indicator` | `outline:none` suppression that hides keyboard focus |
| `negative-tabindex` | Links removed from tab order with `tabindex="-1"` |
| `fake-form-control` | Custom radio/checkbox elements missing ARIA roles |
| `new-tab-warning` | `target="_blank"` links without screen-reader warning |

**🧩 Monaco Diff Editor**
Every AI-generated fix is rendered in a side-by-side `<DiffEditor>`. Developers see exactly what changed — line by line. Nothing is applied silently. Fixes can be manually edited in the Modified pane before applying. Human-in-the-loop by design.

**👁️ Live Preview Window**
After applying fixes, open a full-page iframe preview directly inside AllyFlow. Images load from the scanned site's origin, CSS renders correctly, scripts execute, and interactive elements respond — exactly as the exported file will behave in a browser. Press `Escape` or click Close to dismiss.

**📊 SEO Health Check**
Every audit also runs a lightweight SEO check alongside the accessibility scan — title tags, meta descriptions, heading hierarchy, canonical links — surfaced in the same reporting view.

**📁 File Upload Support**
Paste a URL or drag-and-drop a local HTML file. The full audit and fix pipeline works identically on uploaded files, enabling offline workflows and testing against staging builds.

**📈 Daily Scan Tracker**
A persistent usage counter tracks scans per day, giving teams lightweight visibility into audit activity without requiring a database.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         AllyFlow Client                          │
│                                                                  │
│  UrlInputBar → AuditResults ──→ DiffViewer (Monaco Editor)       │
│                    │                    │                        │
│             BestPracticesPanel    PreviewModal (iframe)          │
└──────────────────┬─────────────────────┬────────────────────────┘
                   │  HTTP POST          │  HTTP POST
        ┌──────────┴──────┐     ┌────────┴────────────┐
        │                 │     │                     │
   /api/scan         /api/heal  /api/best-practices   /api/best-practices/heal
        │                 │     │                     │
  Puppeteer +      Strategy     7-rule heuristic      Gemini AI +
  axe-core         Decision     scanner               Offline fallback
  Hibernation           │
  Method          ┌─────┴──────────┐
  WCAG 2.1 AA     │                │
  SEO checks  Heuristic       Gemini 2.5 Flash
                Fix Engine    (Temp: 0.1, few-shot)
                    │                │
              Deterministic    Raw HTML only
                Fixes          No markdown
                    └─────┬──────────┘
                          │
                   Sentinel stripped
                   Event handlers normalized
                   Paths absolutized
                          │
                   Fixed HTML → Diff View → Preview → Export
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS + shadcn/ui |
| Code Editor | `@monaco-editor/react` |
| Audit Engine | `axe-core` 4.11 |
| Browser Automation | Puppeteer |
| AI Provider | Google Gemini 2.5 Flash → 1.5 Flash → 1.5 Pro (auto-fallback) |
| Icons | Lucide React |
| Notifications | Sonner |

---

## Getting Started

### Prerequisites

- **Node.js** v18 or higher
- A **Google Gemini API Key** — get one free at [ai.google.dev](https://ai.google.dev/)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Yahyagitt/AllyFlow-An-AI-Assisted-Accessibility-Remediation-IDE.git
cd AllyFlow-An-AI-Assisted-Accessibility-Remediation-IDE

# 2. Install dependencies
npm install

# 3. Configure environment variables
echo "GEMINI_API_KEY=your_api_key_here" > .env.local

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Built-In Test Page

AllyFlow ships with a handcrafted page deliberately full of WCAG violations — missing labels, broken keyboard navigation, contrast failures, and more. To see the full workflow in action:

```
http://localhost:3000/test.html
```

---

## The Demo Workflow

```
1.  Enter a URL or upload a file  →  Any public page or local HTML file
2.  Run the audit                 →  axe-core + Best Practices scan runs
3.  Browse violations             →  Grouped by impact, expandable by node
4.  Click "Fix with AI"           →  Node enters ✦ Healing state
5.  Review the diff               →  Monaco editor shows original vs. fixed
6.  Approve or edit manually      →  You decide what ships
7.  Open Preview                  →  Full live iframe — images, scripts, styles
8.  Export Document               →  Clean HTML, paths absolutized, scripts restored
```

No fix is ever applied without explicit developer approval.

---

## Design Principles

**Human-in-the-Loop.** AI drafts. Humans approve. Every single time.

**Fail-Safe by Default.** The offline heuristic engine guarantees a valid fix is always returned, regardless of AI availability or quota status.

**Compound Safety.** Every fix passes through three normalization layers before reaching the master document — route-level, client-level, and apply-level — preventing event handler corruption across multiple repair cycles.

**Deterministic AI Output.** Temperature `0.1` and strict few-shot prompting keep Gemini responses tight, predictable, and raw — no markdown, no prose, no hallucinations.

**Zero Sentinel Leakage.** Internal tracking attributes (`data-af-target`) used for precise node targeting are stripped at every exit point — preview, apply, and export — and never reach the final file.

---

## Limitations

- **Single page analysis** — audits one URL at a time; no multi-page or sitemap crawling
- **Public URLs only** — pages behind authentication or VPNs require the file upload workflow
- **AI suggestion accuracy** — generated fixes (alt text, labels) reflect context available in the DOM and should be reviewed before applying
- **No persistent history** — scan results are session-only; refreshing clears the workspace

---

## Roadmap

- [x] Export remediated HTML to file
- [x] Live preview window with scripts and styles
- [x] Best practices engine (motor, cognitive, screen-reader violations)
- [x] Offline heuristic fallback when AI is unavailable
- [x] HTML file upload support
- [ ] VS Code extension integration
- [ ] Support for authenticated pages (session injection)
- [ ] WCAG 2.2 rule coverage
- [ ] CI/CD pipeline integration (GitHub Actions artifact scanning)
- [ ] Violation history and progress tracking per domain

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

```bash
# Type check
npx tsc --noEmit

# Run linter
npm run lint

# Build for production
npm run build
```

---

<div align="center">

<br/>

**Built for a more accessible web.**

*Because compliance isn't optional — but suffering through it should be.*

<br/>

</div>

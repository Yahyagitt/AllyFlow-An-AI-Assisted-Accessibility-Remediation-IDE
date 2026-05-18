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

[![Next.js](https://img.shields.io/badge/Next.js_15-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Gemini AI](https://img.shields.io/badge/Gemini_1.5_Flash-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
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

**Audit → Analyze → Fix → Approve.** In one tool.

---

## ✦ Feature Breakdown

<br/>

**🔍 Headless Axe-Core Auditing**
Puppeteer launches a real browser context, injects axe-core, and runs a full WCAG 2.1 AA audit against any public URL. Violations are returned with impact levels, failing node HTML, and structured fix targets.

**🛡️ Safe DOM Scanning (The Hibernation Method)**
Before scanning, AllyFlow surgically mutates the live DOM — renaming `<script>` tags to `<allyflow-script>` and rewriting `onclick` to `data-af-onclick`. Scripts remain structurally in place but cannot execute. No accidental form submissions. No state mutations. No side effects.

**🤖 AI Remediation Engine**
Powered by `gemini-1.5-flash` with temperature set to `0.1` for near-deterministic output. Few-shot prompting forces the model to return raw HTML only — no markdown fences, no explanations, no hallucinated document wrappers. The output is a clean, drop-in replacement.

**⚡ JSDOM Structural Fix Engine**
For predictable violations (missing `lang`, empty button labels, absent landmark roles), a deterministic JSDOM engine resolves the issue without touching the AI layer at all. Faster, offline, and perfectly consistent.

**🧩 Monaco Diff Editor**
Every AI-generated fix is rendered in a side-by-side `<DiffEditor>` powered by `@monaco-editor/react`. Developers see exactly what changed — nothing is applied silently. Human-in-the-loop by design.

**🔁 Heuristic Regex Fallback Engine**
When the LLM is rate-limited, unavailable, or returns passive/unchanged code, a pure JavaScript fallback intercepts the request. It applies regex-based structural mutations — converting `<div role="button">` to `<button>`, correcting ARIA toggles, enforcing contrast-safe hex values — ensuring the workflow never stalls.

**📊 Impact-Stratified Reporting**
Violations are grouped by severity: `Critical`, `Serious`, `Moderate`, and `Minor`. Each group is expandable, and individual failing nodes can be cycled through independently for granular remediation.

**📈 Daily Scan Tracker**
A persistent usage counter tracks scans per day, giving teams lightweight visibility into audit activity without requiring a database.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        AllyFlow Client                       │
│                                                             │
│   UrlInputBar → AuditResults → DiffViewer (Monaco Editor)   │
└────────────────────────┬────────────────────────────────────┘
                         │  HTTP POST
          ┌──────────────┴──────────────┐
          │                             │
   /api/scan                       /api/heal
          │                             │
   Puppeteer + axe-core        Strategy Decision
   Hibernation Method               │
   WCAG 2.1 AA Audit          ┌─────┴──────┐
          │              JSDOM Fix    Gemini 1.5 Flash
   Violations JSON        Engine      (Temp: 0.1)
                               │           │
                          Deterministic  Few-shot
                             Fixes      Prompting
                               └─────┬──────┘
                                     │
                            Regex Fallback Engine
                            (if AI fails/rate-limits)
                                     │
                              Fixed HTML → Diff View
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 + shadcn/ui |
| Code Editor | `@monaco-editor/react` 4.6 |
| Audit Engine | `axe-core` 4.11 |
| Browser Automation | Puppeteer 24 |
| DOM Manipulation | JSDOM 29 |
| AI Provider | Google Generative AI SDK (`gemini-1.5-flash`) |
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
git clone https://github.com/yourusername/allyflow.git
cd allyflow

# 2. Install dependencies
npm install

# 3. Configure environment variables
#    Create a .env.local file in the project root:
echo "GEMINI_API_KEY=your_api_key_here" > .env.local

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Built-In Test Page

AllyFlow ships with a handcrafted page that is deliberately full of WCAG violations — missing labels, broken keyboard navigation, contrast failures, and more. To see the full workflow in action:

```
http://localhost:3000/test.html
```

---

## The Demo Workflow

```
1.  Enter a URL                →  Paste any publicly accessible page
2.  Run the audit              →  axe-core scans via headless Puppeteer
3.  Browse violations          →  Grouped by impact, expandable by node
4.  Click "Fix with AI"        →  Node enters ✦ Healing state
5.  Review the diff            →  Monaco editor shows original vs. fixed
6.  Approve or iterate         →  You decide what ships
```

No fix is ever applied without explicit developer approval.

---

## Design Principles

**Human-in-the-Loop.** AI drafts. Humans approve. Every single time.

**Fail-Safe by Default.** The heuristic fallback engine guarantees a valid fix is always returned, regardless of LLM availability.

**Structural Bypass.** AllyFlow will never attempt to auto-fix `<html>` or `<body>` tags. Document-level mutations are outside scope and skipped gracefully.

**Deterministic AI Output.** Temperature `0.1` and strict few-shot prompting keep Gemini responses tight, predictable, and raw — no markdown, no prose, no hallucinations.

---

## Roadmap

- [ ] Export remediated HTML directly to file
- [ ] VS Code extension integration
- [ ] Support for authenticated pages (session injection)
- [ ] WCAG 2.2 rule coverage
- [ ] CI/CD pipeline integration (GitHub Actions artifact scanning)
- [ ] Violation history and progress tracking per domain

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

```bash
# Run linter
npm run lint

# Build for production
npm run build
```

---

---

<div align="center">

<br/>

**Built for a more accessible web.**

*Because compliance isn't optional — but suffering through it should be.*

<br/>

</div>

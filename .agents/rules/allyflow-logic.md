---
trigger: always_on
---

AllyFlow Core Rules
Hybrid Fix Engine: Use deterministic Node.js scripts (JSDOM) for structural changes (e.g., adding lang, role, or label). Use Gemini AI ONLY for semantic text (e.g., alt text, aria-label).

Snapshot Policy: Always strip <script> tags and onclick/onload attributes from the HTML snapshot before rendering the preview.

Audit Tool: Use axe-core via Puppeteer as the primary source of truth for accessibility violations.

UI Constraint: Use a single-page Dashboard layout with Lucide-React icons and Glassmorphism styling. Prioritize the "Before/After" Monaco Diff view as the central focus.

State Management: Use React State and Local Storage for the prototype. Do not initialize external databases (PostgreSQL/Prisma) to keep the demo fast and portable.
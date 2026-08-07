# Open Source EMS / ERP — Options Shortlist

Research date: 2026-08-04
Scope: Employee Management System (EMS / HRMS) and full ERP, open source only.
All GitHub numbers verified directly from the GitHub API on this date.

---

## 1. QUICK ANSWER

| Goal | Pick | One-line reason |
|---|---|---|
| Use it for HR only | **Frappe HR** | Complete and free, nothing paywalled, Indian payroll built in |
| Use it for HR + accounting/inventory | **ERPNext** | Same platform as Frappe HR, no Enterprise edition exists |
| Fork / learn / build on top | **Horilla** | Plain Django + LGPL-2.1, easiest code to read and modify |
| May sell as a closed product | **Apache OFBiz** | Only Apache-2.0 (permissive) option; everything else is copyleft |
| Best UI / demo appeal | **Odoo Community** | Best looking, but payroll + full accounting are paid |

---

## 2. SHORTLIST — THE 4 THAT SURVIVED FILTERING

### Frappe HR  — best pure EMS
- Repo: https://github.com/frappe/hrms
- 8,321 stars | GPL-3.0 | Python (Frappe Framework) | commits daily
- **No paid edition. What is on GitHub is 100% of the product.**
- Covers: employee records, org chart, attendance, shifts, leave, payroll,
  onboarding/offboarding, appraisals, expense claims (~13 modules)
- India statutory compliance (PF, ESI, TDS, gratuity, professional tax) is
  first-class — the vendor is an India-based company
- Runs standalone. ERPNext is only needed if you want payroll to auto-post
  journal entries into accounting
- Naming note: "Frappe" = the framework (not an EMS).
  "Frappe HR" = the EMS product. Formerly called "ERPNext HR"
- Weakness: no low-code builder; meaningful changes need Python

### ERPNext — best full ERP
- Repo: https://github.com/frappe/erpnext
- 37,543 stars | GPL-3.0 | Python (Frappe Framework) | commits daily
- **Largest genuinely-open ERP — there is no Enterprise edition at all**
- Covers: accounting, inventory, manufacturing, sales, purchase, CRM, projects, HR
- Upgrades are unusually painless: customizations are stored as metadata
  (DocTypes), not as forked code
- Growing from Frappe HR into ERPNext is an install, not a migration
- Weakness: rougher UI than Odoo; no drag-and-drop studio

### Horilla — best to fork / build on
- Repo: https://github.com/horilla/horilla-hr
- 1,309 stars | **LGPL-2.1** (loosest copyleft in this category) | Python / Django
- **Plain Django — no custom framework to learn first.** Biggest advantage
  for a developer who wants to read or modify the code
- Covers: recruitment, onboarding, attendance, leave, payroll, assets, helpdesk,
  offboarding
- Vendor claims built-in PF/ESI/TDS/professional tax support
  (source is their own comparison page — VERIFY before relying on it)
- Weakness: smallest team here, thinnest documentation
- Free to self-host; managed cloud is ~$7/user/month

### Odoo Community — best UX, open-core trap
- Repo: https://github.com/odoo/odoo
- 53,445 stars | LGPL-3.0 (license file read and confirmed) | Python | commits daily
- Genuinely open source and usable in production for free
- Best UI, best docs, ~30k community addons (Odoo Apps store + OCA)
- **BUT it is open core — see section 4 for exactly what is withheld**

---

## 3. RULED OUT (and why)

| Project | Stars | Why not |
|---|---|---|
| OrangeHRM | 1,107 | Open core — recruitment, performance, onboarding are paywalled |
| IceHrm | 720 | Open core — community edition capped |
| Sentrifugo | 540 | **Dead** — last commit 2021 |
| Ever Gauzy | 3,829 | AGPL-3.0; time-tracking/agency focused, niche fit |
| MintHCM | 387 | AGPL-3.0, SuiteCRM fork, very small team |
| OpenHRMS | 169 | Not standalone — just a bundle of Odoo addons |
| Axelor Open Suite | 965 | Java, AGPL, heavyweight, consultant-oriented |
| metasfresh | 2,390 | Java, GPL-2.0, wholesale/distribution niche |
| iDempiere | 643 | Java/OSGi, GPL-2.0, small community |
| Apache OFBiz | 1,096 | Apache-2.0 (good) but it's a framework, not a product |
| Tryton | 213 | Clean design, near-zero community — you'd be on your own |
| Bigcapital | 3,816 | Accounting only — not an EMS or ERP |

---

## 4. ODOO COMMUNITY — FREE vs PAID (critical for planning)

### Included free (Community, LGPL-3)
- CRM, Sales, **Invoicing only**, Point of Sale, Contacts, Calendar, Discuss
- Inventory, Purchase, Manufacturing (MRP), Maintenance, Repairs, Fleet
- Project management, Timesheets
- HR: Employees, Recruitment, Time Off, Attendances, Expenses
- Website builder, eCommerce, Blog, Forum, Live Chat
- Email Marketing, Events, Surveys
- Full source access, unlimited users, unlimited customization

### Enterprise-only (paid, closed source)
- **Odoo Studio** — the no-code customization tool
- **Full Accounting** — bank sync, reconciliation, assets, budgets, consolidation
- **Payroll**  <-- matters most for an EMS
- **Appraisals**
- Native mobile apps (Community is browser-only)
- Version upgrade tooling (Community = manual migration)
- Helpdesk, Field Service, Planning, Quality, Sign, Documents,
  Marketing Automation, Appointments, IoT
- All Odoo 19 AI features (NL queries, AI agents, document processing)

### Planning implication
Odoo Community gives you employee records, recruitment, leave and attendance
free — but **payroll and appraisals are behind the paywall**, which are usually
the two main reasons to want an HRMS. OCA publishes community payroll modules
but they are less maintained and country localizations are patchy.

Frappe HR includes payroll, appraisals AND Indian compliance for free,
because there is no paid build.

---

## 5. LICENSE CHEAT SHEET (decides fork/commercial use)

Licenses below were confirmed by reading the actual LICENSE files, not GitHub labels.

| License | Projects | What it means |
|---|---|---|
| **Apache-2.0** | Apache OFBiz | Permissive. Only safe choice if you may ship closed-source or sell a derivative |
| **LGPL-2.1** | Horilla | Loosest copyleft here. Friendliest for building on top |
| **LGPL-3.0** | Odoo Community | Can run/host freely; linking rules are lenient |
| **GPL-3.0** | Frappe HR, ERPNext, Dolibarr | Free to run and host. Copyleft triggers on **distribution** |
| **GPL-2.0** | metasfresh, iDempiere | Same idea, older version |
| **AGPL-3.0** | Axelor, Ever Gauzy, MintHCM, Bigcapital | Strictest — offering it as a **hosted service** obligates you to publish your modifications |

Rule of thumb:
- Internal company use -> any of these is fine
- Public SaaS -> avoid AGPL unless you'll publish changes (or buy a commercial license)
- Closed/proprietary product -> Apache OFBiz only

---

## 6. INFRASTRUCTURE REQUIREMENTS

| System | Minimum | Production |
|---|---|---|
| ERPNext / Frappe HR | 4 GB RAM, 2 cores, 40 GB, 2 GB swap | 8 GB RAM, 4 cores, 100 GB SSD |
| Odoo Community | 2 GB RAM, 2 vCPU, 20 GB (dev only) | 4-8 GB RAM, 4 cores (~25 users); 16 GB for ~50 users |
| Horilla (Django) | Lightest of the three | Scales with normal Django practice |

Notes:
- All three run via Docker
- Use Linux for production. Windows/WSL2 is fine for local development only
- Odoo workers consume ~150-300 MB each; budget 6-8 workers per 50 users

---

## 7. TERMINOLOGY (avoid the common confusion)

- **EMS / HRMS** = the people layer only: employee records, attendance, leave,
  payroll, appraisals
- **ERP** = the whole business on one shared database: accounting, inventory,
  sales, purchasing, manufacturing, projects — **and HR as one module**
- So an EMS is roughly one module's worth of an ERP

Frappe naming specifically:
- **Frappe Framework** = a web framework (like Django). Not an EMS
- **Frappe HR** = the EMS product built on it. THIS is what you install
- **ERPNext** = the full ERP built on the same framework

---

## 8. OPEN DECISIONS (to resolve before choosing)

- [ ] Headcount — 10 people and 500 people land on different rows
- [ ] Country / payroll compliance requirements
- [ ] Production deployment or portfolio/learning project?
- [ ] Use as-is, fork and extend, or just study the architecture?
- [ ] Will it ever be offered as a hosted service to others? (decides AGPL question)
- [ ] Verify Horilla's Indian statutory claims independently (vendor-sourced)

---

## 9. ARCHITECTURE REFERENCES (if studying rather than deploying)

- **Frappe DocType model** — schema, permissions, forms and REST API all generated
  from a single JSON definition. Most interesting idea in this space
- **Odoo ORM + inheritance modules** — `_inherit` lets addons patch core models
  without forking. Excellent extensibility pattern
- **Apache OFBiz entity/service engine** — XML-declared data model and service
  contracts. Verbose but the most explicit separation of concerns
- **Tryton** — smallest codebase to read end-to-end to understand modular ERP

---

## 10. SOURCES

- Frappe HR: https://github.com/frappe/hrms
- ERPNext: https://github.com/frappe/erpnext
- Horilla: https://github.com/horilla/horilla-hr | https://www.horilla.com/
- Odoo: https://github.com/odoo/odoo
- Odoo Community apps list: https://www.odoo.com/forum/help-1/list-of-community-edition-apps-free-189585
- Odoo Community guide 2026: https://theledgerlabs.com/odoo-community-edition-guide/
- Odoo Community limits: https://oec.sh/odoo-pricing/community
- ERPNext vs Odoo: https://tcbinfotech.com/odoo-vs-erpnext-comparison/
- HRMS comparison: https://www.horilla.com/compare/horilla-vs-orange-hrms/
- ERPNext requirements: https://www.pb4host.com/erpnext-system-requirements/
- Odoo sizing 2026: https://oec.sh/blog/odoo-server-requirements-2026
- India payroll compliance: https://openhr.tech/payroll-software-india
- Ever Gauzy licensing: https://github.com/ever-co/ever-gauzy/wiki/Licensing
- Axelor licensing: https://axelor.com/erp-open-source/
- OrangeHRM editions: https://orangehrm.com/orangehrm-starter-open-source-software

---
name: csv-formula-injection-guard
description: Use when writing CSV or Excel export with user text.
category: security
---

# CSV formula injection guard

Directive: prefix a single quote to any string cell whose first non-space character is `=`, `+`, `-`, `@`, tab or CR, so spreadsheets read it as text.

- Regex: `/^(?=\s*[=+\-@\t\r])/`. Test it with leading spaces (`"  =SUM(A1)"`) as well as plain formulas.
- Guard string cells only. Numbers go through `String(v)` unguarded, so real negatives such as `-120` are not mangled.
- Keep the guard in the one shared CSV helper, not in each page that exports.
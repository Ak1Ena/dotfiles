---
name: dependency-bump-scope
description: Use when bumping a dependency version, e.g. sharp.
category: dependencies
---

Edit only the manifest the user names. A version bump does not license touching lockfiles, deploy or layer scripts, or other pins.

- Make the named change only. Then list the knock-on work (lockfile sync, build scripts that hard-code the same version, engines or runtime limits) and ask before doing any of it.
- Check whether the change breaks install: `npm ci --dry-run`. If it fails, say so and name the fix; do not apply it unasked.
- When the user narrows scope ("package.json only"), revert the extra edits right away (`git checkout -- <file>`) and keep only the named change.
- Do not commit unless asked.

---
name: push-consent
description: Use when about to git push or force-push.
category: git-workflow
---

# Ask before pushing

Do not run `git push` (including force-push, or a branch that starts a tmp or test build) unless the user asked for that exact push in the current turn.

- Offering a push is a question. Name the branch, the commit and what it triggers, then wait.
- A push approval covers `git push` only. Posting PR comments, marking a PR ready or draft, and editing a PR body each need their own ask in the current turn.
- An earlier "yes" to a different push does not cover this one.
- If the user says "don't push" or interrupts a push-related step, stop all push steps and confirm in one line that nothing was pushed.
- A vague or half-heard go-ahead ("if you are fix na", "ok push", "yes do it") is not consent for a specific branch. Keep the work committed locally, name the branch and head, and ask in one line.
- Before each push, re-read the newest user message for a stop ("don't push yet"). A push already sent cannot be recalled, so report the pushed head and the remote branch in the reply that follows it.
- A stacked PR chain has one branch per PR (for example D0, D1, D2). Push only the branch the user named for this task. Pushing a lower or sibling branch (D0 while the work is on D1) is its own push: ask first, and never copy this task's change onto it.
- Screenshot gate: when the user asks for screenshots before a push, shoot every changed board from the exact head to be pushed and show them. Push only after the user's approval in a later message. "Screenshot all, push if I approve" is two steps.
- Shell cwd can reset between commands. A bare `git push` then runs from the main checkout on whatever branch it holds. Push a worktree branch with `git -C <worktree-path> push origin <branch>`, then read back the remote ref and commit to confirm what landed.
- A rebase or history rewrite (dropping commits, `--force-with-lease`) is its own push. Before asking, name the branch, the commits being replaced, the new base, and that the PR number and reviews stay. Ask only after every teammate on that branch has reported its final push, and re-fetch the remote head right before the push so the lease matches what you reviewed.

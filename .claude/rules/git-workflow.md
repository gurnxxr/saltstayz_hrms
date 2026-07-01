# Git Workflow

## Branch Strategy

- `main` — stable, production-ready
- `master` — current working branch
- Feature branches: `feature/{module-name}` or `fix/{issue-description}`

## Commits

Commit messages: imperative mood, 1-2 sentences on the "why".

```
Add attendance calendar view with monthly summary

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

## Before Committing

- Do NOT commit `.env`, `server/data/hrms.db`, `node_modules/`, `.next/`
- Stage specific files, not `git add -A`
- Check `git diff --staged` before committing

## Sensitive Files — Never Commit

- `server/.env` (JWT_SECRET)
- `server/data/*.db` (database files)
- `cookies.txt` (test cookies)
- Any CSV with employee PII

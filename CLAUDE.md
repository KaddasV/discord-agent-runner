# Repository Rules & AI Agent Guidelines

## 🚨 Git Workflow & Pull Request Rules (CRITICAL & MANDATORY)
- **SEPARATE PULL REQUESTS ONLY**: Every feature request, enhancement, bug fix, or refactor made to this repository MUST be implemented on a separate git branch and submitted as an independent GitHub Pull Request.
- **NO DIRECT COMMITS**: NEVER commit or push changes directly to `dev`, `master`, or `main`.
- **Branch Naming Conventions**:
  - Feature requests: `feature/<short-descriptive-name>` or `feat/<short-descriptive-name>`
  - Bug fixes: `fix/<short-descriptive-name>`
  - Documentation/chores: `docs/<short-descriptive-name>` or `chore/<short-descriptive-name>`

## Step-by-Step Execution Workflow for AI Agents
When tasked with implementing a feature or fix in this repository, you must strictly follow these steps:
1. **Sync Base Branch**: Fetch latest remote changes and switch to the `dev` branch (which serves as the primary base branch):
   ```bash
   git fetch origin
   git checkout dev && git pull origin dev
   ```
2. **Cut New Branch**: Create and switch to a new, isolated branch for the task:
   ```bash
   git checkout -b <branch-name>
   ```
3. **Implement & Verify**: Make the necessary source code edits. Run the TypeScript build and tests to verify there are no syntax or compilation errors:
   ```bash
   npm run build
   ```
4. **Commit**: Stage changes and write a clear Conventional Commit message (e.g., `feat: ...`, `fix: ...`):
   ```bash
   git add .
   git commit -m "<type>: <description>"
   ```
5. **Push to Remote**: Push the branch to remote origin:
   ```bash
   git push origin <branch-name>
   ```
6. **Open Pull Request**: Use the GitHub CLI (`gh`) to open a separate Pull Request targeting `dev`:
   ```bash
   gh pr create --base dev --head <branch-name> --title "<type>: <title>" --body "### Summary of Changes\n- <details>\n\n### Verification\n- Verified via npm run build"
   ```
7. **Report**: Output the exact URL of the created GitHub Pull Request in your response so the user can review and merge it. DO NOT auto-merge the Pull Request unless explicitly instructed to do so by the user in their prompt.

## Project Architecture & Commands
- **Language/Stack**: TypeScript, Node.js, Discord.js v14, OpenCode CLI, Docker / Docker Compose.
- **Build Command**: `npm run build` (compiles `src/` to `dist/`).
- **Dev/Local Execution**: `npm start` or `docker compose up -d --build`.
- **Key Modules**:
  - `src/index.ts`: Discord bot client, slash command handling, modal & button interaction routing.
  - `src/runner.ts`: Subprocess execution wrapper around `opencode run`.
  - `src/commands.ts`: Slash command builder definitions.

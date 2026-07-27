# 🤖 Discord Agent Runner

A decoupled, remote control plane for executing AI coding agents (OpenCode CLI, Aider, etc.) on your local machine directly from your mobile phone via Discord.

Designed for AI-native development teams offloading background procedures, routine maintenance, unit tests, and feature work to cheap models like **DeepSeek V4**, **Gemini 3.6 Flash**, or **Claude Sonnet**.

---

## 🌟 Key Features

*   **📱 Remote Phone Control**: Send commands from your phone via Discord to your running PC without public IPs, port forwarding, or VPNs.
*   **📁 Dynamic Repo Selector**: Interactive dropdown menu (`/repo`) that auto-discovers all repositories on your PC (`C:\Users\vdkad\`) or lets you switch between `EscapeNONE`, `escapenone-web`, `project-genesis`, etc.
*   **🤖 Model Selection**: Run tasks with your choice of model (`--model deepseek-v4`, `--model gemini-3.6-flash`, `--model claude-3-7-sonnet`).
*   **📄 CLAUDE.md & Rules Respect**: Automatically operates inside the selected target directory so OpenCode CLI reads and respects `CLAUDE.md`, `.claude/rules`, and repository guidelines.
*   **🔒 User Lockdown**: Security lock to restrict execution strictly to authorized Discord User IDs.
*   **🧪 Built-in Verification**: Run project test suites (`./mvnw test`, `npm test`) on demand (`/verify`).

---

## 🚀 Quick Setup Guide

### 1. Create a Discord Bot Token
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** $\rightarrow$ Name it **`AgentRunner`**.
3. Under **Bot**:
   * Reset Token and copy your **Bot Token**.
   * Turn ON **Message Content Intent**.
4. Under **OAuth2**:
   * Copy your **Client ID**.
   * Go to **URL Generator** $\rightarrow$ Select scopes: `bot`, `applications.commands`.
   * Under Bot Permissions: Select `Send Messages`, `Embed Links`, `Read Message History`.
   * Open the generated link to invite the bot to your private Discord server.

### 2. Configure `.env`
Create or edit `.env` in `discord-agent-runner`:
```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here

# (Recommended) Restrict to your Discord User ID (Right click your name in Discord -> Copy User ID)
ALLOWED_USER_IDS=123456789012345678

DEFAULT_MODEL=deepseek-v4
AGENT_CLI=opencode
REPOS_DIR=C:/Users/vdkad
```

### 3. Run on your PC
```bash
# Start bot
npm start
```

---

## 📱 Mobile Usage Flow

1. Open Discord on your mobile phone.
2. Type `/repo` $\rightarrow$ Select project (e.g. `EscapeNONE`, `project-genesis`).
3. Type `/task prompt: "Write unit tests for the catalogue module" model: "deepseek-v4"`.
4. Your PC executes OpenCode CLI in the repository directory, runs tests, and posts the results back to your phone!
5. Type `/verify` to run the project's build & test verification.

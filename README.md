# 🐳 Discord Agent Runner (Dockerized Multi-Developer Remote Control)

A containerized, decoupled remote control plane for executing AI coding agents (**OpenCode CLI**, **Aider**, etc.) on your local PC directly from your mobile phone via Discord.

Designed for AI-native development teams. Multiple developers can join the **same shared Discord server** and run their own container instance on their own PC. Each container listens **only** to commands issued by its configured owner!

---

## 🏗️ Multi-Developer Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │      SHARED TEAM DISCORD SERVER              │
                    └──────────────────────┬───────────────────────┘
                                           │
           ┌───────────────────────────────┼───────────────────────────────┐
           │                               │                               │
    [ User A's Phone ]              [ User B's Phone ]              [ User C's Phone ]
    (ID: 111111111)                 (ID: 222222222)                 (ID: 333333333)
           │                               │                               │
           ▼                               ▼                               ▼
    [ Bot Gateway ]                 [ Bot Gateway ]                 [ Bot Gateway ]
           │                               │                               │
           ▼                               ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐         ┌─────────────────────┐
│ Developer A's PC    │         │ Developer B's PC    │         │ Developer C's PC    │
│ Container Instance  │         │ Container Instance  │         │ Container Instance  │
│ (MY_USER_ID=1111)   │         │ (MY_USER_ID=2222)   │         │ (MY_USER_ID=3333)   │
│ Exec: A's Local Code│         │ Exec: B's Local Code│         │ Exec: C's Local Code│
└─────────────────────┘         └─────────────────────┘         └─────────────────────┘
```

---

## 📋 Requirements & Setup Checklist

To get started, every developer needs:
1. **Docker Desktop** (or Docker Engine) installed on their PC.
2. **An invite link** to your team's private Discord Server.
3. Their personal **Discord User ID**.
4. The **Shared Discord Bot Token** & **Client ID**.

---

### Step 1: Get Your Discord User ID (All Developers)
1. Open Discord on Desktop or Mobile.
2. Go to **User Settings** $\rightarrow$ **Advanced** $\rightarrow$ Turn ON **Developer Mode**.
3. Right-click your profile picture/username in Discord $\rightarrow$ Click **Copy User ID**.
4. Save this ID (e.g. `123456789012345678`).

---

### Step 2: Create & Invite Bot (One-Time Admin Setup)
*(Only one person needs to do this per team/server)*

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** $\rightarrow$ Name it **`AgentRunner`**.
3. Under **Bot**:
   * Click **Reset Token** and copy the **Bot Token**.
   * Turn ON **Message Content Intent**.
4. Under **OAuth2**:
   * Copy the **Client ID**.
   * Go to **URL Generator** $\rightarrow$ Select scopes: `bot`, `applications.commands`.
   * Select Bot Permissions: `Send Messages`, `Embed Links`, `Read Message History`.
   * Open the generated link to invite the bot to your team's Discord server.
5. Share the **Bot Token** and **Client ID** with your co-developers.

---

### Step 3: Run Container on Your PC

1. Clone this repository on your PC:
   ```bash
   git clone https://github.com/KaddasV/discord-agent-runner.git
   cd discord-agent-runner
   ```

2. Create a `.env` file (copy from `.env.example`):
   ```env
   DISCORD_TOKEN=shared_bot_token_here
   DISCORD_CLIENT_ID=shared_client_id_here

   # 🔑 YOUR PERSONAL DISCORD USER ID (Binds container to YOU)
   MY_USER_ID=123456789012345678

   # Default cheap model
   DEFAULT_MODEL=deepseek-v4
   AGENT_CLI=opencode

   # Path to your local projects on host PC
   HOST_WORKSPACE_PATH=C:/Users/vdkad
   ```

3. Launch with Docker Compose:
   ```bash
   docker compose up -d --build
   ```

---

## 📱 Mobile Usage Guide

Open Discord on your mobile phone and use these commands:

| Command | Action |
| :--- | :--- |
| **`/repo`** | Opens an interactive dropdown listing all repos found in your local workspace. Select the active project for your session. |
| **`/task prompt: "..." [model: "..."]`** | Launches OpenCode CLI locally on your PC in the selected repo folder (e.g., `--model deepseek-v4` or `--model gemini-3.6-flash`). |
| **`/verify`** | Executes build & test suite (`./mvnw test` / `npm test`) on your local project and reports pass/fail logs. |
| **`/status`** | Displays active repository, target user binding, and runner execution state. |
| **`/cancel`** | Terminates any active agent process running on your PC. |

---

## 💡 How CLAUDE.md & Repository Guidelines Work
When you select a project using `/repo` (e.g., `EscapeNONE`), the container changes working directory to that folder before executing `opencode run`. 

OpenCode CLI natively detects and reads `CLAUDE.md`, `.claude/rules`, and architectural constraints directly from the selected folder, ensuring all code modifications follow your project's strict rules!

---

## 🛠️ Running Without Docker (Direct Node.js Execution)

If you prefer to run directly on host Node.js without containers:
```bash
npm install
npm run build
npm start
```

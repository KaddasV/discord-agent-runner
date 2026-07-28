FROM node:22-bookworm AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm AS runner

# Install essential dev tools: git, curl, openjdk-17-jdk, maven, python3, gnupg, and GitHub CLI (gh)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    openjdk-17-jdk \
    maven \
    gnupg \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Configure global git user and gh git-credential helper so git push and gh commands work autonomously
RUN git config --global user.name "AI Agent Runner" && \
    git config --global user.email "agent@opencode.ai" && \
    git config --global credential.https://github.com.helper "" && \
    git config --global --add credential.https://github.com.helper "!gh auth git-credential"

# Install OpenCode CLI globally
RUN npm install -g opencode-ai || true

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# Copy compiled JavaScript output from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env* ./

ENV NODE_ENV=production
ENV REPOS_DIR=/workspace

VOLUME ["/workspace"]

CMD ["node", "dist/index.js"]

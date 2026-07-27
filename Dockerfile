FROM node:22-bookworm AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm AS runner

# Install essential dev tools: git, curl, openjdk-17-jdk, maven, python3
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    openjdk-17-jdk \
    maven \
    && rm -rf /var/lib/apt/lists/*

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

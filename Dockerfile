FROM node:22-bookworm

# Install essential dev tools: git, curl, openjdk-21-jdk / maven, python3
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

# Copy package descriptors & install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .
RUN npm run build

# Default environment variables
ENV NODE_ENV=production
ENV REPOS_DIR=/workspace

VOLUME ["/workspace"]

CMD ["node", "dist/index.js"]

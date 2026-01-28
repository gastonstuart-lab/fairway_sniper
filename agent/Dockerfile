# Use Playwright's official image which bundles browsers and a suitable Node runtime
# This isolates the agent from local host issues (sandbox, conflicting node processes)
FROM mcr.microsoft.com/playwright:latest

# Create app directory
WORKDIR /usr/src/app

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --silent

# Copy agent source
COPY . .

# Expose port used by agent HTTP server
EXPOSE 3000

# Use a non-root user where available (Playwright base image often sets pwuser)
USER pwuser

# Default envs
ENV AGENT_RUN_MAIN=false
ENV AGENT_HEADLESS=true
ENV NODE_ENV=production

# Default command
CMD ["node", "./index.js"]

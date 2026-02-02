FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application code
COPY . ./

# Set environment
ENV NODE_ENV=production
ENV AGENT_RUN_MAIN=true

# Start application
EXPOSE 8080
CMD ["node", "index.js"]

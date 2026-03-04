# Multi-stage build for production hardening
# PR-10: Deployment hardening

# Stage 1: Build dependencies
FROM node:22-alpine AS builder

WORKDIR /build

# Install build dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Production image
FROM node:22-alpine AS production

# Security: Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package*.json ./

# Copy source code
COPY src ./src

# Set proper permissions
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8787/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

EXPOSE 8787

CMD ["node", "src/index.js"]

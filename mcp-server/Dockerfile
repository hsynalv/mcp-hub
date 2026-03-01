FROM node:22-alpine

WORKDIR /app

# Install deps first (cached layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src ./src

EXPOSE 8787

CMD ["node", "src/index.js"]

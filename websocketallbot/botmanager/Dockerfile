FROM node:20-slim

# Install Chromium + ChromeDriver + all required system libraries
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Environment: tell selenium/chrome where binaries are
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver
ENV NODE_ENV=production

WORKDIR /app

# Copy package.json files first for better Docker layer caching
COPY backend/package.json ./backend/package.json
COPY bots/package.json ./bots/package.json

# Install backend dependencies (includes selenium-webdriver)
RUN cd backend && npm install --omit=dev

# Install bot dependencies (selenium-webdriver)
RUN cd bots && npm install --omit=dev

# Copy the rest of the source files
COPY . .

# Make bots resolve selenium-webdriver from their own node_modules
ENV NODE_PATH=/app/bots/node_modules

# Create logs directory
RUN mkdir -p logs

EXPOSE 3001

CMD ["node", "backend/server.js"]

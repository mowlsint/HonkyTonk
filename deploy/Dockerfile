FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright HOST=0.0.0.0 PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npx playwright install --with-deps chromium --only-shell
COPY index2.html automation-client.js honkytonk.png honkytonk_mini.png honkytonk.ico ./
COPY automation ./automation
COPY scripts/honkytonk-automation.mjs ./scripts/honkytonk-automation.mjs
RUN mkdir -p /app/.honkytonk-data && chown -R node:node /app /ms-playwright
USER node
EXPOSE 8787
CMD ["node", "scripts/honkytonk-automation.mjs", "serve"]

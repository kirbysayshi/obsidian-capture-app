FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
EXPOSE 8080
ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
CMD ["node", "dist/index.js"]

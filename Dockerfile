# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

ARG VITE_MICROSOFT_CLIENT_ID
ARG VITE_MICROSOFT_TENANT_ID=common
ARG VITE_SIGNING_API_URL
ARG VITE_USB_SIGNING_AGENT_URL
ENV VITE_MICROSOFT_CLIENT_ID=${VITE_MICROSOFT_CLIENT_ID}
ENV VITE_MICROSOFT_TENANT_ID=${VITE_MICROSOFT_TENANT_ID}
ENV VITE_SIGNING_API_URL=${VITE_SIGNING_API_URL}
ENV VITE_USB_SIGNING_AGENT_URL=${VITE_USB_SIGNING_AGENT_URL}

RUN npm run build

FROM nginx:1.30.3-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]

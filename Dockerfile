FROM node:24-alpine AS frontend

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.25-alpine AS backend

ARG TARGETOS=linux
ARG TARGETARCH=amd64
WORKDIR /src
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
RUN rm -rf web/dist
RUN mkdir -p web/dist
COPY --from=frontend /src/frontend/dist/ ./web/dist/
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/vdo ./cmd/vdo

FROM alpine:3.22 AS mediamtx

ARG MEDIAMTX_VERSION=1.20.1
ARG TARGETARCH=amd64
RUN apk add --no-cache ca-certificates curl tar
RUN curl -fsSL "https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}/mediamtx_v${MEDIAMTX_VERSION}_linux_${TARGETARCH}.tar.gz" -o /tmp/mediamtx.tar.gz \
  && tar -xzf /tmp/mediamtx.tar.gz -C /tmp \
  && test -x /tmp/mediamtx

FROM alpine:3.22

ARG VDO_UID=10001
ARG VDO_GID=10001

RUN apk add --no-cache ca-certificates su-exec \
  && addgroup -S -g "$VDO_GID" vdo \
  && adduser -S -D -H -u "$VDO_UID" -G vdo vdo \
  && mkdir -p /data/recordings \
  && chown -R vdo:vdo /data

COPY --from=backend /out/vdo /usr/local/bin/vdo
COPY --from=mediamtx /tmp/mediamtx /usr/local/bin/mediamtx
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

ENV VDO_DATA_DIR=/data \
  VDO_MEDIAMTX_BIN=/usr/local/bin/mediamtx \
  VDO_TLS_CERT_FILE=/certs/server.crt \
  VDO_TLS_KEY_FILE=/certs/server.key \
  VDO_PUBLIC_ADDR=:8443 \
  VDO_INTERNAL_ADDR=127.0.0.1:8080

EXPOSE 8443/tcp 8889/tcp 8189/udp 8189/tcp 8890/udp
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

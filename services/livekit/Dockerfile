# livekit-server v1.13.8 с отчётами TWCC по времени.
#
# Зачем: ответчик TWCC в mediatransportutil шлёт отчёт только когда накоплено
# > 20 видеопакетов. На просевшем канале (~6 пак/с) отчёты идут раз в 3–5 с,
# Chrome сбрасывает оценку полосы (kStreamTimeOut 2 с), и камера ученика
# 70–100 с остаётся на 180p. С отчётом каждые 100 мс — 8–12 с (A/B, см.
# test-results/livekit-production-hardening-2026-10-07/03-congestion-control.md).
# Не исправлено ни в 1.13.8, ни в master. Как только апстрим примет правку —
# вернуть официальный образ livekit/livekit-server.
#
# Сборка повторяет upstream Dockerfile v1.13.8; меняется только зависимость.
FROM golang:1.26.7-alpine3.24@sha256:28d89ee9cc0ff9fec75c82ca201e6bf7fdf9a679d4b7b24dfa04f2bb766bb468 AS builder

ARG LIVEKIT_VERSION=v1.13.8
# Ровно та версия mediatransportutil, на которую ссылается go.mod v1.13.8.
ARG MTU_COMMIT=f234b534b095

RUN apk add --no-cache git patch
ENV GOTOOLCHAIN=local

WORKDIR /src
RUN git clone --depth 1 -b ${LIVEKIT_VERSION} https://github.com/livekit/livekit.git livekit \
 && git clone https://github.com/livekit/mediatransportutil.git mediatransportutil \
 && git -C mediatransportutil checkout ${MTU_COMMIT}

COPY twcc-report-by-time.patch /src/
RUN patch -d mediatransportutil -p1 < twcc-report-by-time.patch \
 && grep -q 'PacketsHeld() > 0 &&' mediatransportutil/pkg/twcc/twcc.go

WORKDIR /src/livekit
RUN go mod edit -replace github.com/livekit/mediatransportutil=../mediatransportutil \
 && go mod download
RUN (cd ../mediatransportutil && go test ./pkg/twcc/...) \
 && CGO_ENABLED=0 GOOS=linux go build -a -o /livekit-server ./cmd/server

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
RUN apk upgrade --no-cache
COPY --from=builder /livekit-server /livekit-server
ENTRYPOINT ["/livekit-server"]

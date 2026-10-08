# livekit-server v1.13.9 с отчётами TWCC по времени.
#
# Зачем: ответчик TWCC в mediatransportutil шлёт отчёт только когда накоплено
# > 20 видеопакетов. На просевшем канале (~6 пак/с) отчёты идут раз в 3–5 с,
# Chrome сбрасывает оценку полосы (kStreamTimeOut 2 с), и камера ученика
# 70–100 с остаётся на 180p. С отчётом каждые 100 мс — 8–12 с (A/B, см.
# test-results/livekit-production-hardening-2026-10-07/03-congestion-control.md).
# Не исправлено ни в 1.13.9, ни в master. Как только апстрим примет правку —
# вернуть официальный образ livekit/livekit-server.
#
# Сборка повторяет upstream Dockerfile; меняется только зависимость.
# 1.13.9 (#4957): без него сервер брал allow_pause из запроса клиента на
# пути с одним PeerConnection (livekit-client 2.22 по умолчанию), то есть false.
FROM golang:1.26.7-alpine3.24@sha256:28d89ee9cc0ff9fec75c82ca201e6bf7fdf9a679d4b7b24dfa04f2bb766bb468 AS builder

ARG LIVEKIT_VERSION=v1.13.9
# Ровно та версия mediatransportutil, на которую ссылается go.mod v1.13.9
# (та же, что в v1.13.8).
ARG MTU_COMMIT=f234b534b095

RUN apk add --no-cache git patch
ENV GOTOOLCHAIN=local

WORKDIR /src
RUN git clone --depth 1 -b ${LIVEKIT_VERSION} https://github.com/livekit/livekit.git livekit \
 && git clone https://github.com/livekit/mediatransportutil.git mediatransportutil \
 && git -C mediatransportutil checkout ${MTU_COMMIT}

# Окно возврата после обрыва медиа: ICE рвётся через 10+5 с, дальше сервер
# ждал клиента всего 5 с и закрывал участника. Обрыв дольше ~20 с (лифт,
# режим полёта, переключение сети на iPhone) кончался не быстрым resume, а
# полным переподключением: «could not restart participant» и ещё ~7–12 с без
# медиа (тест 2026-10-08). 30 с — окно ~45 с; плитка пропавшего участника
# всё это время остаётся в комнате, присутствие приложения сверяется с LiveKit.
RUN sed -i 's/disconnectCleanupDuration          = 5 \* time.Second/disconnectCleanupDuration          = 30 * time.Second/' livekit/pkg/rtc/participant.go \
 && grep -q 'disconnectCleanupDuration          = 30 \* time.Second' livekit/pkg/rtc/participant.go

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

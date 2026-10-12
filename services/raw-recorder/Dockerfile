# Экспериментальная запись уроков (docs/experimental-recording.md):
# один образ на две роли — `rawrec record` (во время урока) и `rawrec render`
# (сборка MP4 после урока).
#
# База — тот же образ LiveKit Egress, что уже работает на сервере: в нём
# Google Chrome и шрифты Noto (кадры доски рендерит Chrome). ffmpeg —
# статическая сборка jrottenberg/ffmpeg (тот же Ubuntu 24.04), в /opt/ffmpeg
# со своими библиотеками: системные библиотеки Chrome/GStreamer не трогаем.

FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/rawrec ./cmd/rawrec

FROM jrottenberg/ffmpeg:7.1-ubuntu AS ffmpeg

FROM livekit/egress:v1.14.1
USER root
COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffprobe /opt/ffmpeg/bin/
COPY --from=ffmpeg /usr/local/lib/ /opt/ffmpeg/lib/
RUN printf '#!/bin/sh\nLD_LIBRARY_PATH=/opt/ffmpeg/lib exec /opt/ffmpeg/bin/ffmpeg "$@"\n' > /usr/local/bin/ffmpeg \
 && printf '#!/bin/sh\nLD_LIBRARY_PATH=/opt/ffmpeg/lib exec /opt/ffmpeg/bin/ffprobe "$@"\n' > /usr/local/bin/ffprobe \
 && chmod 755 /usr/local/bin/ffmpeg /usr/local/bin/ffprobe \
 && ffmpeg -hide_banner -version | head -1
COPY --from=build /out/rawrec /usr/local/bin/rawrec
# Тот же uid, что у app (999): файлы записи на общем томе удаляет API.
ENV HOME=/tmp
USER 999:999
ENTRYPOINT ["/usr/local/bin/rawrec"]

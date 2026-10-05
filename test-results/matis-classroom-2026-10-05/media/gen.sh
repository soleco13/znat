#!/bin/sh
# Медиа симулированных учеников. Видео: H.264 baseline 640x360@15, ~300 кбит/с,
# ключевой кадр раз в 2 с — как камера ученика 360p. 95 мин: lk не зацикливает файл.
# Аудио спикеров: цикл 100 с — S1 [0,15), S7 [20,35), учитель [40,55) (мик в браузере),
# S14 [60,75), все трое [80,95). Розовый шум со «слогами» 4 Гц — уровень как у речи.
set -e
D=5700
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=640x360:rate=15" -t $D \
  -c:v libx264 -preset ultrafast -profile:v baseline -tune zerolatency -b:v 300k -maxrate 330k -bufsize 300k \
  -g 30 -keyint_min 30 -sc_threshold 0 -bsf:v h264_mp4toannexb -f h264 video.h264
speak() { # $1=file $2=cond
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "anoisesrc=color=pink:amplitude=0.35:sample_rate=48000" -t $D \
    -af "volume=eval=frame:volume='if($2, 0.55+0.45*sin(2*PI*4*t), 0)'" -ac 1 -c:a libopus -b:a 24k -frame_duration 20 "$1"
}
speak s1.ogg "lt(mod(t,100),15)+between(mod(t,100),80,95)"
speak s7.ogg "between(mod(t,100),20,35)+between(mod(t,100),80,95)"
speak s14.ogg "between(mod(t,100),60,75)+between(mod(t,100),80,95)"
# Учитель: 20 с «речи» по кругу (Chrome зацикливает WAV), говорит, когда драйвер включает мик.
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "anoisesrc=color=pink:amplitude=0.35:sample_rate=48000" -t 20 \
  -af "volume=eval=frame:volume='0.55+0.45*sin(2*PI*4*t)'" -ac 1 -c:a pcm_s16le teacher.wav
ls -la

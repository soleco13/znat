// rawrec — экспериментальная запись уроков Матиса (docs/experimental-recording.md).
//
//	rawrec record   — воркер записи: берёт задания у API, пишет дорожки урока;
//	rawrec render   — воркер сборки: после урока собирает MP4;
//	rawrec convert  <recordingDir> <outDir> <t0Ms> — только конвертация (отладка).
//
// Настройки — переменные окружения (см. docker-compose.raw-recorder.yml).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/livekit/protocol/logger"
	lksdk "github.com/livekit/server-sdk-go/v2"

	"matis/raw-recorder/internal/apiclient"
	"matis/raw-recorder/internal/convert"
	"matis/raw-recorder/internal/recorder"
	"matis/raw-recorder/internal/render"
)

func env(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}

func envInt(name string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(name)); err == nil {
		return v
	}
	return def
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: rawrec record|render|convert")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	host, _ := os.Hostname()
	storage := env("STORAGE_ROOT", "/data/assets")
	switch os.Args[1] {
	case "record", "render":
		apiURL := env("MATIS_API_URL", "http://127.0.0.1:3000")
		secret := os.Getenv("RAW_RECORDER_SECRET")
		if len(secret) < 32 {
			fmt.Fprintln(os.Stderr, "RAW_RECORDER_SECRET is required (32+ chars)")
			os.Exit(2)
		}
		api := apiclient.New(apiURL, secret)
		workerID := env("WORKER_ID", host) + "/" + os.Args[1]
		if os.Args[1] == "record" {
			logger.InitFromConfig(&logger.Config{Level: env("LIVEKIT_LOG_LEVEL", "warn"), JSON: true}, "rawrec")
			lksdk.SetLogger(logger.GetLogger())
			log.Info("raw recorder started", "worker", workerID, "api", apiURL)
			recorder.NewWorker(recorder.Config{
				StorageRoot: storage,
				WorkerID:    workerID,
				MaxJobs:     envInt("RAW_RECORDER_MAX_JOBS", 10),
			}, api, log).Run(ctx)
		} else {
			log.Info("raw render started", "worker", workerID, "api", apiURL)
			render.NewWorker(render.Config{
				StorageRoot:   storage,
				WorkerID:      workerID,
				ChromePath:    env("CHROME_PATH", "/usr/bin/google-chrome"),
				ChromeSandbox: env("CHROME_SANDBOX", "true") == "true",
				FontFile:      env("FONT_FILE", "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"),
				FrameStepMs:   int64(envInt("FRAME_STEP_MS", 500)),
				Parallel:      envInt("RENDER_PARALLEL", 2),
				MaxSegmentSec: envInt("MAX_SEGMENT_SEC", 0),
				X264Preset:    env("RENDER_X264_PRESET", "veryfast"),
			}, api, log).Run(ctx)
		}
	case "playcheck":
		if len(os.Args) != 3 {
			fmt.Fprintln(os.Stderr, "usage: rawrec playcheck <file.mp4>")
			os.Exit(2)
		}
		res, err := render.PlayCheck(ctx, env("CHROME_PATH", "/usr/bin/google-chrome"), os.Args[2], env("CHROME_SANDBOX", "true") == "true")
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		out, _ := json.MarshalIndent(res, "", "  ")
		fmt.Println(string(out))
	case "convert":
		if len(os.Args) != 5 {
			fmt.Fprintln(os.Stderr, "usage: rawrec convert <recordingDir> <outDir> <t0Ms>")
			os.Exit(2)
		}
		t0, err := strconv.ParseInt(os.Args[4], 10, 64)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		idx, err := convert.ConvertRecording(os.Args[2], os.Args[3], t0)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		out, _ := json.MarshalIndent(idx, "", "  ")
		fmt.Println(string(out))
	default:
		fmt.Fprintln(os.Stderr, "unknown command", os.Args[1])
		os.Exit(2)
	}
}

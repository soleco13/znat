// Package render — после урока: исходные дорожки + журнал → один MP4.
//
// Шаги (каждый с контрольной точкой в каталоге `render/` записи, повторный
// запуск после падения воркера продолжает с места остановки):
//
//	convert  — RTP → IVF/Ogg на общей шкале (пакет convert);
//	journal  — журнал урока из API: состав, сцены, моменты изменений доски;
//	layout   — сегменты с постоянной раскладкой;
//	frames   — кадры доски/задания: Chrome открывает `/recording-replay`
//	           и снимает PNG в моменты изменений (те же React-компоненты);
//	segments — каждый сегмент в H.264 (ffmpeg), одинаковые параметры;
//	audio    — все микрофоны на одну шкалу → AAC;
//	mux      — склейка сегментов без перекодирования + звук → MP4;
//	verify   — ffprobe + пробное декодирование;
//	publish  — атомарный rename во `outputKey`; отчёт серверу.
//
// Исходные дорожки не трогаются: их удаляет сервер по ретеншну после ready.
package render

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"matis/raw-recorder/internal/apiclient"
	"matis/raw-recorder/internal/convert"
	"matis/raw-recorder/internal/dump"
)

type Config struct {
	StorageRoot   string
	WorkerID      string
	ChromePath    string
	ChromeSandbox bool
	FontFile      string
	// FrameStepMs — не чаще одного кадра доски за столько мс (2 кадра/с по умолчанию).
	FrameStepMs int64
	// Parallel — сколько сегментов кодировать одновременно.
	Parallel int
}

type Worker struct {
	cfg Config
	api *apiclient.Client
	log *slog.Logger
}

func NewWorker(cfg Config, api *apiclient.Client, log *slog.Logger) *Worker {
	if cfg.FrameStepMs <= 0 {
		cfg.FrameStepMs = 500
	}
	if cfg.Parallel <= 0 {
		cfg.Parallel = 2
	}
	return &Worker{cfg: cfg, api: api, log: log}
}

// Run — по одному заданию за раз (рендер сам параллелит сегменты).
func (w *Worker) Run(ctx context.Context) {
	if n := w.api.RecoverWithRetry(ctx, w.cfg.WorkerID); n > 0 {
		w.log.Warn("recovered renders of previous process", "count", n)
	}
	for ctx.Err() == nil {
		job, err := w.api.ClaimRender(ctx, w.cfg.WorkerID)
		if err != nil {
			if ctx.Err() == nil {
				w.log.Warn("render claim failed", "err", err)
			}
		} else if job != nil {
			w.runJob(ctx, job)
			continue
		}
		select {
		case <-ctx.Done():
		case <-time.After(5 * time.Second):
		}
	}
}

// permanentError — повтор не поможет (нет данных).
type permanentError struct{ error }

func (w *Worker) runJob(parent context.Context, job *apiclient.RenderJob) {
	log := w.log.With("recordingId", job.RecordingID, "attempt", job.Attempt)
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	var stepMu sync.Mutex
	step := "claimed"
	setStep := func(s string) {
		stepMu.Lock()
		step = s
		stepMu.Unlock()
		hbCtx, c := context.WithTimeout(ctx, 10*time.Second)
		if err := w.api.RenderHeartbeat(hbCtx, job.RecordingID, job.LeaseID, s); errors.Is(err, apiclient.ErrLeaseLost) {
			log.Warn("render lease lost")
			cancel()
		}
		c()
		log.Info("render step", "step", s)
	}
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				stepMu.Lock()
				s := step
				stepMu.Unlock()
				hbCtx, c := context.WithTimeout(ctx, 10*time.Second)
				if err := w.api.RenderHeartbeat(hbCtx, job.RecordingID, job.LeaseID, s); errors.Is(err, apiclient.ErrLeaseLost) {
					log.Warn("render lease lost")
					cancel()
				}
				c()
			}
		}
	}()

	started := time.Now()
	result, err := w.render(ctx, job, setStep, log)
	if ctx.Err() != nil && parent.Err() == nil && err != nil {
		return // лиза потеряна — задание у другого воркера
	}
	report, c := context.WithTimeout(context.Background(), 30*time.Second)
	defer c()
	if err != nil {
		var perm permanentError
		retryable := !errors.As(err, &perm)
		log.Error("render failed", "err", err, "retryable", retryable)
		if rerr := w.api.RenderFailed(report, job.RecordingID, job.LeaseID, err.Error(), retryable); rerr != nil {
			log.Warn("render failure report failed", "err", rerr)
		}
		return
	}
	result.Metrics["renderWallSec"] = round2(time.Since(started).Seconds())
	// Моменты взятия и окончания — для разбора очереди (ожидание = взятие − постановка).
	result.Metrics["claimedAtMs"] = started.UnixMilli()
	result.Metrics["finishedAtMs"] = time.Now().UnixMilli()
	if rerr := w.api.RenderFinished(report, job.RecordingID, job.LeaseID, result.DurationSec, result.SizeBytes, result.Metrics); rerr != nil {
		log.Error("render finish report failed", "err", rerr)
		return
	}
	log.Info("render done", "durationSec", result.DurationSec, "sizeBytes", result.SizeBytes, "wallSec", time.Since(started).Seconds())
}

type Result struct {
	DurationSec float64
	SizeBytes   int64
	Metrics     map[string]any
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func (w *Worker) render(ctx context.Context, job *apiclient.RenderJob, setStep func(string), log *slog.Logger) (*Result, error) {
	root := w.cfg.StorageRoot
	recDir := filepath.Join(root, filepath.FromSlash(job.RecordingDir))
	work := filepath.Join(recDir, "render")
	tracksDir := filepath.Join(work, "tracks")
	if err := os.MkdirAll(work, 0o755); err != nil {
		return nil, err
	}
	metrics := map[string]any{}
	var cpu time.Duration
	timed := func(name string, fn func() error) error {
		t := time.Now()
		setStep(name)
		err := fn()
		metrics["step_"+name+"_sec"] = round2(time.Since(t).Seconds())
		return err
	}
	durMs := job.T1Ms - job.T0Ms
	if durMs <= 0 {
		return nil, permanentError{fmt.Errorf("empty timeline")}
	}

	// 1. convert
	var idx *convert.Index
	if err := timed("convert", func() error {
		var err error
		idx, err = convert.ConvertRecording(recDir, tracksDir, job.T0Ms)
		return err
	}); err != nil {
		return nil, err
	}
	tracks := map[string]convert.Track{}
	var audioFiles []string
	rawBytes := dirSize(recDir, "render")
	var lost, packets, dropped, unsupported int
	for _, t := range idx.Tracks {
		tracks[t.Key] = t
		packets += t.Packets
		lost += t.LostPackets
		dropped += t.Dropped
		if !t.Supported {
			unsupported++
		}
		if t.Kind == "audio" && t.Supported && t.Frames > 0 {
			audioFiles = append(audioFiles, filepath.Join(tracksDir, t.File))
		}
	}
	metrics["tracks"] = len(idx.Tracks)
	metrics["tracksUnsupported"] = unsupported
	metrics["rtpPackets"] = packets
	metrics["rtpLostPackets"] = lost
	metrics["videoFramesDropped"] = dropped
	metrics["rawBytes"] = rawBytes
	if len(idx.Tracks) == 0 {
		return nil, permanentError{fmt.Errorf("no media tracks recorded")}
	}

	// 2. journal
	var events []apiclient.JournalEvent
	if err := timed("journal", func() error {
		var err error
		events, err = w.api.Journal(ctx, job.RecordingID)
		return err
	}); err != nil {
		return nil, err
	}
	completeness := CheckJournal(events)
	metrics["journalEvents"] = completeness.Events
	metrics["journalResumes"] = completeness.Resumes
	metrics["journalMaxGapMs"] = completeness.MaxGapMs
	metrics["journalDropped"] = completeness.Dropped

	// 3. layout
	g := NewGeometry(job.Width, job.Height)
	scenes, changeTimes := ScenesFromJournal(events, job.T0Ms, durMs)
	segs := BuildSegments(Inputs{
		DurationMs: durMs,
		Presence:   PresenceFromJournal(events, job.T0Ms),
		Scenes:     scenes,
		Tracks:     idx.Tracks,
	}, g)
	metrics["segments"] = len(segs)
	layoutJSON, _ := json.MarshalIndent(segs, "", " ")
	_ = os.WriteFile(filepath.Join(work, "layout.json"), layoutJSON, 0o644)

	// 4. frames — кадры доски/задания
	frames, err := w.captureFrames(ctx, job, g, segs, changeTimes, filepath.Join(work, "frames"), timed, metrics)
	if err != nil {
		return nil, err
	}

	// 5. segments
	fps := job.FPS
	totalFrames := int64(math.Round(float64(durMs) * float64(fps) / 1000))
	segDir := filepath.Join(work, "segments")
	if err := os.MkdirAll(segDir, 0o755); err != nil {
		return nil, err
	}
	segFiles := make([]string, len(segs))
	if err := timed("segments", func() error {
		return w.renderSegments(ctx, &cpu, job, g, segs, tracks, frames, tracksDir, segDir, totalFrames, segFiles)
	}); err != nil {
		return nil, err
	}
	durSec := float64(totalFrames) / float64(fps)

	// 6. audio
	audio := filepath.Join(work, "audio.m4a")
	if err := timed("audio", func() error {
		if fileDone(audio) {
			return nil
		}
		if err := mixAudio(ctx, &cpu, audioFiles, durSec, audio+".tmp.m4a"); err != nil {
			return err
		}
		return markDone(audio+".tmp.m4a", audio)
	}); err != nil {
		return nil, err
	}

	// 7. mux
	muxed := filepath.Join(work, "output.mp4")
	if err := timed("mux", func() error {
		return concatAndMux(ctx, &cpu, segFiles, audio, filepath.Join(work, "segments.txt"), muxed)
	}); err != nil {
		return nil, err
	}

	// 8. verify
	var pr Probe
	if err := timed("verify", func() error {
		var err error
		pr, err = verifyOutput(ctx, &cpu, muxed, durSec, job.Width, job.Height)
		return err
	}); err != nil {
		return nil, err
	}

	// 9. publish — rename в пределах одной ФС атомарен: недописанный файл под именем записи не появится.
	final := filepath.Join(root, filepath.FromSlash(job.OutputKey))
	var size int64
	if err := timed("publish", func() error {
		if err := os.MkdirAll(filepath.Dir(final), 0o775); err != nil {
			return err
		}
		// Рабочий каталог и записи — на одном томе: rename без копирования.
		// Другой том — копия во временное имя рядом и rename уже там.
		if err := os.Rename(muxed, final); err != nil {
			staging := final + ".partial"
			if cerr := copyFile(muxed, staging); cerr != nil {
				return fmt.Errorf("publish: rename: %v; copy: %w", err, cerr)
			}
			if err := os.Rename(staging, final); err != nil {
				return err
			}
		}
		if d, err := os.Open(filepath.Dir(final)); err == nil {
			_ = d.Sync()
			d.Close()
		}
		st, err := os.Stat(final)
		if err != nil {
			return err
		}
		size = st.Size()
		return nil
	}); err != nil {
		return nil, err
	}
	metrics["renderCpuSec"] = round2(cpu.Seconds())
	metrics["outputBytes"] = size
	metrics["outputDurationSec"] = round2(pr.DurationSec)
	metrics["frames"] = len(frames)
	// Рабочие файлы сборки больше не нужны (исходники остаются).
	_ = os.RemoveAll(segDir)
	_ = os.Remove(muxed)
	return &Result{DurationSec: round2(pr.DurationSec), SizeBytes: size, Metrics: metrics}, nil
}

func (w *Worker) renderSegments(ctx context.Context, cpu *time.Duration, job *apiclient.RenderJob, g Geometry, segs []Segment,
	tracks map[string]convert.Track, frames []Frame, tracksDir, segDir string, totalFrames int64, segFiles []string) error {
	fps := float64(job.FPS)
	type task struct {
		i      int
		params segmentParams
		out    string
	}
	var tasks []task
	for i, s := range segs {
		fStart := int64(math.Round(float64(s.StartMs) * fps / 1000))
		fEnd := int64(math.Round(float64(s.EndMs) * fps / 1000))
		if i == len(segs)-1 {
			fEnd = totalFrames
		}
		out := filepath.Join(segDir, fmt.Sprintf("seg-%04d.mp4", i))
		segFiles[i] = out
		if fEnd <= fStart {
			fEnd = fStart + 1
		}
		if fileDone(out) {
			continue
		}
		wd := filepath.Join(segDir, fmt.Sprintf("seg-%04d.work", i))
		tasks = append(tasks, task{i: i, out: out, params: segmentParams{
			Seg: s, Geometry: g, FPS: job.FPS, FrameStart: fStart, FrameCount: fEnd - fStart,
			BitrateKb: job.VideoBitrateKbps, TracksDir: tracksDir, WorkDir: wd, Tracks: tracks,
			Frames: frames, FontFile: w.cfg.FontFile,
		}})
	}
	var mu sync.Mutex
	var firstErr error
	var cpuTotal time.Duration
	sem := make(chan struct{}, w.cfg.Parallel)
	var wg sync.WaitGroup
	for _, t := range tasks {
		t := t
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			mu.Lock()
			failed := firstErr != nil
			mu.Unlock()
			if failed || ctx.Err() != nil {
				return
			}
			var c time.Duration
			err := func() error {
				if err := os.MkdirAll(t.params.WorkDir, 0o755); err != nil {
					return err
				}
				tmp := t.out + ".tmp.mp4"
				if err := renderSegment(ctx, &c, t.params, tmp); err != nil {
					return fmt.Errorf("segment %d (%s): %w", t.i, t.params.Seg, err)
				}
				_ = os.RemoveAll(t.params.WorkDir)
				return markDone(tmp, t.out)
			}()
			mu.Lock()
			cpuTotal += c
			if err != nil && firstErr == nil {
				firstErr = err
			}
			mu.Unlock()
		}()
	}
	wg.Wait()
	*cpu += cpuTotal
	if firstErr != nil {
		return firstErr
	}
	return ctx.Err()
}

// captureFrames — кадры главной области для сегментов доски/задания.
func (w *Worker) captureFrames(ctx context.Context, job *apiclient.RenderJob, g Geometry, segs []Segment, changeTimes []int64,
	dir string, timed func(string, func() error) error, metrics map[string]any) ([]Frame, error) {
	var want []int64
	for _, s := range segs {
		if s.Main != MainBoard && s.Main != MainActivity {
			continue
		}
		want = append(want, s.StartMs)
		for _, t := range changeTimes {
			if t > s.StartMs && t < s.EndMs {
				want = append(want, t)
			}
		}
	}
	if len(want) == 0 {
		return nil, nil
	}
	// Не чаще шага: моменты в пределах шага сводятся к концу интервала (виден итог правок).
	step := w.cfg.FrameStepMs
	sort.Slice(want, func(i, j int) bool { return want[i] < want[j] })
	var times []int64
	for _, t := range want {
		q := ((t + step - 1) / step) * step
		if n := len(times); n == 0 || q > times[n-1] {
			times = append(times, q)
		}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	var frames []Frame
	err := timed("frames", func() error {
		b, err := StartBrowser(ctx, w.cfg.ChromePath, g.Main.W, g.Main.H, w.cfg.ChromeSandbox)
		if err != nil {
			return fmt.Errorf("chrome: %w", err)
		}
		defer b.Close()
		if err := b.Navigate(ctx, job.ReplayURL); err != nil {
			return err
		}
		deadline := time.Now().Add(90 * time.Second)
		for {
			var st struct {
				State string `json:"state"`
				Error string `json:"error"`
			}
			_ = b.Eval(ctx, `({state: window.__matisReplay ? window.__matisReplay.state : "loading", error: window.__matisReplay ? window.__matisReplay.error : null})`, &st)
			if st.State == "ready" {
				break
			}
			if st.State == "error" {
				return fmt.Errorf("replay page: %s", st.Error)
			}
			if time.Now().After(deadline) {
				return errors.New("replay page did not become ready")
			}
			time.Sleep(300 * time.Millisecond)
		}
		for i, t := range times {
			path := filepath.Join(dir, fmt.Sprintf("f-%09d.png", t))
			var res struct {
				Kind string `json:"kind"`
			}
			if err := b.Eval(ctx, fmt.Sprintf("window.__matisReplay.seek(%d)", job.T0Ms+t), &res); err != nil {
				return fmt.Errorf("seek %d: %w", t, err)
			}
			if !fileDone(path) {
				png, err := b.ScreenshotPNG(ctx)
				if err != nil {
					return err
				}
				if err := dump.WriteFileAtomic(path, png); err != nil {
					return err
				}
			}
			frames = append(frames, Frame{AtMs: t, Path: path})
			if i%200 == 0 {
				metrics["framesCaptured"] = i
			}
		}
		return nil
	})
	return frames, err
}

// ScenesFromJournal — сцены (доска/задание/люди) и моменты изменений главной
// области — та же логика, что у страницы кадров и шаблона `/egress`.
func ScenesFromJournal(events []apiclient.JournalEvent, t0Ms, durMs int64) ([]SceneChange, []int64) {
	stage := "people"
	activity := ""
	var scenes []SceneChange
	var changes []int64
	push := func(ts int64) {
		at := clamp(ts-t0Ms, 0, durMs)
		kind := "people"
		if activity != "" {
			kind = "activity"
		} else if stage == "board" {
			kind = "board"
		}
		if n := len(scenes); n > 0 {
			if scenes[n-1].Kind == kind {
				return
			}
			if scenes[n-1].AtMs == at {
				scenes[n-1].Kind = kind
				return
			}
		}
		scenes = append(scenes, SceneChange{AtMs: at, Kind: kind})
	}
	push(t0Ms)
	for _, ev := range events {
		switch ev.Kind {
		case "lesson_snapshot":
			var snap struct {
				Stage string `json:"stage"`
			}
			if json.Unmarshal(ev.Payload, &snap) == nil && snap.Stage != "" {
				stage = snap.Stage
				push(ev.TsMs)
			}
		case "room_event":
			var msg struct {
				Type       string `json:"type"`
				Stage      string `json:"stage"`
				ActivityID string `json:"activityId"`
			}
			if json.Unmarshal(ev.Payload, &msg) != nil {
				continue
			}
			switch msg.Type {
			case "stage_changed":
				stage, activity = msg.Stage, ""
				push(ev.TsMs)
			case "activity_started":
				activity = msg.ActivityID
				push(ev.TsMs)
			}
		case "yjs_update", "yjs_snapshot", "viewport", "activity_view":
			changes = append(changes, clamp(ev.TsMs-t0Ms, 0, durMs))
		}
	}
	return scenes, changes
}

func clamp(v, lo, hi int64) int64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func fileDone(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.Size() > 0
}

// markDone — готовый файл шага появляется под своим именем только целиком.
func markDone(tmp, final string) error {
	f, err := os.Open(tmp)
	if err == nil {
		_ = f.Sync()
		f.Close()
	}
	return os.Rename(tmp, final)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func dirSize(root, skip string) int64 {
	var total int64
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() && info.Name() == skip {
			return filepath.SkipDir
		}
		if !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total
}

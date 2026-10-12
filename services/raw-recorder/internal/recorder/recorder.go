// Package recorder — запись урока во время урока: скрытый участник LiveKit
// подписывается на все дорожки и пишет RTP как есть (пакет dump). Ни
// декодирования, ни кодирования: цена записи — сеть и диск.
package recorder

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"

	"matis/raw-recorder/internal/apiclient"
	"matis/raw-recorder/internal/dump"
)

// Config — настройки воркера записи.
type Config struct {
	StorageRoot string
	WorkerID    string
	MaxJobs     int
	// ChunkDuration — длина чанка: столько данных теряется при падении процесса в худшем случае.
	ChunkDuration time.Duration
}

// Worker берёт задания записи и ведёт их параллельно (до MaxJobs).
type Worker struct {
	cfg    Config
	api    *apiclient.Client
	log    *slog.Logger
	active atomic.Int64
	wg     sync.WaitGroup
}

func NewWorker(cfg Config, api *apiclient.Client, log *slog.Logger) *Worker {
	if cfg.ChunkDuration <= 0 {
		cfg.ChunkDuration = 60 * time.Second
	}
	if cfg.MaxJobs <= 0 {
		cfg.MaxJobs = 10
	}
	return &Worker{cfg: cfg, api: api, log: log}
}

// Run — цикл опроса заданий до отмены ctx; при отмене дожидается закрытия идущих записей.
func (w *Worker) Run(ctx context.Context) {
	if n := w.api.RecoverWithRetry(ctx, w.cfg.WorkerID); n > 0 {
		w.log.Warn("recovered recordings of previous process", "count", n)
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		for int(w.active.Load()) < w.cfg.MaxJobs {
			job, err := w.api.ClaimRecord(ctx, w.cfg.WorkerID)
			if err != nil {
				if ctx.Err() == nil {
					w.log.Warn("claim failed", "err", err)
				}
				break
			}
			if job == nil {
				break
			}
			w.active.Add(1)
			w.wg.Add(1)
			go func() {
				defer w.wg.Done()
				defer w.active.Add(-1)
				w.runJob(ctx, job)
			}()
		}
		select {
		case <-ctx.Done():
			w.wg.Wait()
			return
		case <-ticker.C:
		}
	}
}

type session struct {
	job       *apiclient.RecordJob
	dir       string
	log       *slog.Logger
	cfg       Config
	mu        sync.Mutex
	tracks    map[string]*trackWriter
	trackSeq  int
	stopOnce  sync.Once
	stopCh    chan string
	plis      atomic.Int64
	writersWG sync.WaitGroup
}

func (w *Worker) runJob(parent context.Context, job *apiclient.RecordJob) {
	log := w.log.With("recordingId", job.RecordingID, "lessonId", job.LessonID, "attempt", job.Attempt)
	dir := filepath.Join(w.cfg.StorageRoot, filepath.FromSlash(job.AttemptDir))
	s := &session{job: job, dir: dir, log: log, cfg: w.cfg, tracks: map[string]*trackWriter{}, stopCh: make(chan string, 1)}
	reason, runErr := s.run(parent, w.api)
	stats := s.stats()
	var errText *string
	if runErr != nil {
		t := runErr.Error()
		errText = &t
	}
	if errors.Is(runErr, apiclient.ErrLeaseLost) {
		log.Warn("lease lost, recording handed over", "stats", stats)
		return
	}
	// Отчёт с повтором: без него сервер дождётся пропажи лизы (30 с) — тоже рабочий путь.
	for i := 0; i < 5; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		err := w.api.RecordFinished(ctx, job.RecordingID, job.LeaseID, reason, errText, stats)
		cancel()
		if err == nil || errors.Is(err, apiclient.ErrLeaseLost) {
			break
		}
		log.Warn("finish report failed", "err", err)
		time.Sleep(time.Duration(i+1) * 2 * time.Second)
	}
	log.Info("recording finished", "reason", reason, "tracks", stats.Tracks, "packets", stats.Packets, "bytes", stats.Bytes, "lost", stats.LostPackets)
}

func (s *session) stop(reason string) {
	s.stopOnce.Do(func() { s.stopCh <- reason })
}

func (s *session) run(parent context.Context, api *apiclient.Client) (string, error) {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return "error", fmt.Errorf("mkdir: %w", err)
	}
	started := time.Now()
	cb := &lksdk.RoomCallback{
		ParticipantCallback: lksdk.ParticipantCallback{
			OnTrackSubscribed:   s.onTrackSubscribed,
			OnTrackUnsubscribed: s.onTrackUnsubscribed,
			OnTrackPublished: func(pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
				s.applyQuality(pub)
			},
		},
		OnDisconnectedWithReason: func(reason lksdk.DisconnectionReason) {
			s.log.Info("disconnected from room", "reason", reason)
			s.stop("room_closed")
		},
	}
	room, err := lksdk.ConnectToRoomWithToken(s.job.LivekitURL, s.job.LivekitToken, cb, lksdk.WithAutoSubscribe(true))
	if err != nil {
		return "error", fmt.Errorf("connect: %w", err)
	}
	s.log.Info("joined room", "joinMs", time.Since(started).Milliseconds())
	for _, rp := range room.GetRemoteParticipants() {
		for _, pub := range rp.TrackPublications() {
			if rpub, ok := pub.(*lksdk.RemoteTrackPublication); ok {
				s.applyQuality(rpub)
			}
		}
	}

	hbEvery := time.Duration(s.job.HeartbeatIntervalSec) * time.Second
	if hbEvery <= 0 {
		hbEvery = 5 * time.Second
	}
	hb := time.NewTicker(hbEvery)
	defer hb.Stop()
	deadline := time.NewTimer(time.Duration(s.job.MaxDurationSec) * time.Second)
	defer deadline.Stop()

	reason := ""
	var runErr error
loop:
	for {
		select {
		case <-parent.Done():
			// Воркер останавливают (деплой): данные на диске, сервер передаст
			// запись следующему рекордеру новой попыткой.
			reason, runErr = "error", errors.New("worker shutdown")
			break loop
		case r := <-s.stopCh:
			reason = r
			break loop
		case <-deadline.C:
			reason = "max_duration"
			break loop
		case <-hb.C:
			ctx, cancel := context.WithTimeout(parent, 10*time.Second)
			stop, err := api.RecordHeartbeat(ctx, s.job.RecordingID, s.job.LeaseID, s.stats())
			cancel()
			if errors.Is(err, apiclient.ErrLeaseLost) {
				reason, runErr = "error", err
				break loop
			}
			if err != nil {
				// API недоступен — продолжаем писать: урок важнее отчёта.
				s.log.Warn("heartbeat failed", "err", err)
				continue
			}
			if stop {
				reason = "stopped"
				break loop
			}
		}
	}
	room.Disconnect()
	s.closeAll()
	s.writeManifest(started, reason)
	return reason, runErr
}

// applyQuality — слой simulcast: камеры средним, демонстрация высоким (см. задание).
func (s *session) applyQuality(pub *lksdk.RemoteTrackPublication) {
	if pub.Kind() != lksdk.TrackKindVideo {
		return
	}
	q := s.job.CameraQuality
	if pub.Source() == livekit.TrackSource_SCREEN_SHARE {
		q = s.job.ScreenQuality
	}
	quality := livekit.VideoQuality_MEDIUM
	switch q {
	case "low":
		quality = livekit.VideoQuality_LOW
	case "high":
		quality = livekit.VideoQuality_HIGH
	}
	if err := pub.SetVideoQuality(quality); err != nil {
		s.log.Debug("set video quality failed", "err", err)
	}
}

func (s *session) onTrackSubscribed(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
	s.applyQuality(pub)
	s.mu.Lock()
	s.trackSeq++
	key := fmt.Sprintf("%03d_%s_%s_%s", s.trackSeq, dump.SafeName(rp.Identity()), strings.ToLower(pub.Source().String()), dump.SafeName(pub.SID()))
	s.mu.Unlock()
	codec := track.Codec()
	kind := "audio"
	if track.Kind() == webrtc.RTPCodecTypeVideo {
		kind = "video"
	}
	meta := dump.TrackMeta{
		Key:            key,
		Attempt:        s.job.Attempt,
		Identity:       rp.Identity(),
		Name:           rp.Name(),
		TrackSID:       pub.SID(),
		Source:         pub.Source().String(),
		Kind:           kind,
		MimeType:       codec.MimeType,
		ClockRate:      codec.ClockRate,
		Channels:       codec.Channels,
		PayloadType:    uint8(codec.PayloadType),
		SSRC:           uint32(track.SSRC()),
		SubscribedAtNs: time.Now().UnixNano(),
	}
	tw, err := newTrackWriter(filepath.Join(s.dir, key), meta, s.cfg.ChunkDuration, func() {
		rp.WritePLI(track.SSRC())
		s.plis.Add(1)
	}, s.log.With("track", key))
	if err != nil {
		s.log.Error("track writer failed", "err", err, "track", key)
		return
	}
	pub.OnRTCP(func(p rtcp.Packet) {
		if sr, ok := p.(*rtcp.SenderReport); ok {
			tw.writeSR(sr)
		}
	})
	s.mu.Lock()
	s.tracks[pub.SID()+"/"+key] = tw
	s.mu.Unlock()
	if kind == "video" {
		// Ключевой кадр сразу: без него первые секунды дорожки не декодируются.
		tw.requestKeyframe()
	}
	s.writersWG.Add(1)
	go func() {
		defer s.writersWG.Done()
		tw.readLoop(track)
	}()
	s.log.Info("track subscribed", "track", key, "mime", codec.MimeType, "source", pub.Source().String())
}

func (s *session) onTrackUnsubscribed(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
	s.log.Info("track unsubscribed", "identity", rp.Identity(), "sid", pub.SID())
}

func (s *session) closeAll() {
	s.mu.Lock()
	writers := make([]*trackWriter, 0, len(s.tracks))
	for _, tw := range s.tracks {
		writers = append(writers, tw)
	}
	s.mu.Unlock()
	for _, tw := range writers {
		tw.stop()
	}
	done := make(chan struct{})
	go func() {
		s.writersWG.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		s.log.Warn("track writers did not stop in time")
	}
	for _, tw := range writers {
		tw.finish()
	}
}

func (s *session) stats() apiclient.Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := apiclient.Stats{Tracks: int64(len(s.tracks)), KeyframeRequests: s.plis.Load()}
	for _, tw := range s.tracks {
		st.Packets += tw.packets.Load()
		st.Bytes += tw.bytes.Load()
		st.LostPackets += tw.lost.Load()
	}
	return st
}

func (s *session) writeManifest(started time.Time, reason string) {
	s.mu.Lock()
	keys := make([]string, 0, len(s.tracks))
	for _, tw := range s.tracks {
		keys = append(keys, tw.meta.Key)
	}
	s.mu.Unlock()
	manifest := map[string]any{
		"recordingId": s.job.RecordingID,
		"attempt":     s.job.Attempt,
		"startedAtNs": started.UnixNano(),
		"endedAtNs":   time.Now().UnixNano(),
		"reason":      reason,
		"tracks":      keys,
		"stats":       s.stats(),
	}
	data, _ := json.MarshalIndent(manifest, "", "  ")
	if err := dump.WriteFileAtomic(filepath.Join(s.dir, "manifest.json"), data); err != nil {
		s.log.Error("manifest write failed", "err", err)
	}
}

// ─── Дорожка ───────────────────────────────────────────────────────────────

type trackWriter struct {
	dir      string
	meta     dump.TrackMeta
	chunkDur time.Duration
	pli      func()
	log      *slog.Logger

	mu         sync.Mutex
	w          *dump.Writer
	chunkIdx   int
	chunkStart time.Time
	closed     bool

	packets atomic.Int64
	bytes   atomic.Int64
	lost    atomic.Int64
	plis    atomic.Int64

	// Потери: номер пакета → когда заметили пропуск. Пришёл позже (NACK,
	// переупорядочивание) — не потеря; нет дольше 300 мс — просим ключевой кадр.
	haveSeq  bool
	maxSeq   uint16
	missing  map[uint16]time.Time
	lastPLI  time.Time
	stopCh   chan struct{}
	stopOnce sync.Once
}

func newTrackWriter(dir string, meta dump.TrackMeta, chunkDur time.Duration, pli func(), log *slog.Logger) (*trackWriter, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	tw := &trackWriter{dir: dir, meta: meta, chunkDur: chunkDur, pli: pli, log: log, missing: map[uint16]time.Time{}, stopCh: make(chan struct{})}
	if err := dump.WriteMeta(dir, meta); err != nil {
		return nil, err
	}
	if err := tw.rotate(time.Now()); err != nil {
		return nil, err
	}
	go tw.flushLoop()
	return tw, nil
}

func (tw *trackWriter) rotate(now time.Time) error {
	if tw.w != nil {
		if err := tw.w.Close(); err != nil {
			tw.log.Error("chunk close failed", "err", err)
		}
	}
	tw.chunkIdx++
	w, err := dump.Create(filepath.Join(tw.dir, dump.ChunkName(tw.chunkIdx)))
	if err != nil {
		tw.w = nil
		return err
	}
	tw.w = w
	tw.chunkStart = now
	return nil
}

func (tw *trackWriter) write(rec dump.Record) {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	if tw.closed {
		return
	}
	now := time.Unix(0, rec.ArrivalNs)
	if tw.w == nil || now.Sub(tw.chunkStart) >= tw.chunkDur {
		if err := tw.rotate(now); err != nil {
			tw.log.Error("chunk rotate failed", "err", err)
			return
		}
	}
	if err := tw.w.Write(rec); err != nil {
		tw.log.Error("chunk write failed", "err", err)
	}
}

func (tw *trackWriter) writeSR(sr *rtcp.SenderReport) {
	data, err := sr.Marshal()
	if err != nil {
		return
	}
	tw.write(dump.Record{Type: dump.RecordSR, ArrivalNs: time.Now().UnixNano(), Data: data})
}

func (tw *trackWriter) requestKeyframe() {
	tw.lastPLI = time.Now()
	tw.pli()
	tw.write(dump.Record{Type: dump.RecordPLI, ArrivalNs: time.Now().UnixNano()})
	tw.plis.Add(1)
}

func (tw *trackWriter) readLoop(track *webrtc.TrackRemote) {
	buf := make([]byte, 1500)
	for {
		n, _, err := track.Read(buf)
		if err != nil {
			return
		}
		now := time.Now()
		if n < 12 {
			continue
		}
		data := make([]byte, n)
		copy(data, buf[:n])
		tw.write(dump.Record{Type: dump.RecordRTP, ArrivalNs: now.UnixNano(), Data: data})
		tw.packets.Add(1)
		tw.bytes.Add(int64(n))
		tw.trackLoss(binary.BigEndian.Uint16(data[2:4]), now)
		select {
		case <-tw.stopCh:
			return
		default:
		}
	}
}

func (tw *trackWriter) trackLoss(seq uint16, now time.Time) {
	if !tw.haveSeq {
		tw.haveSeq, tw.maxSeq = true, seq
		return
	}
	diff := seq - tw.maxSeq
	switch {
	case diff == 0:
	case diff < 0x8000:
		for s := tw.maxSeq + 1; s != seq && len(tw.missing) < 1000; s++ {
			tw.missing[s] = now
		}
		tw.maxSeq = seq
	default:
		delete(tw.missing, seq) // опоздавший пакет (повтор по NACK)
	}
	lostNow := 0
	for s, at := range tw.missing {
		if now.Sub(at) > 300*time.Millisecond {
			delete(tw.missing, s)
			lostNow++
		}
	}
	if lostNow > 0 {
		tw.lost.Add(int64(lostNow))
		if tw.meta.Kind == "video" && now.Sub(tw.lastPLI) > time.Second {
			tw.requestKeyframe()
		}
	}
}

func (tw *trackWriter) flushLoop() {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-tw.stopCh:
			return
		case <-t.C:
			tw.mu.Lock()
			if tw.w != nil && !tw.closed {
				if err := tw.w.Flush(); err != nil {
					tw.log.Error("flush failed", "err", err)
				}
			}
			tw.mu.Unlock()
		}
	}
}

func (tw *trackWriter) stop() {
	tw.stopOnce.Do(func() { close(tw.stopCh) })
}

func (tw *trackWriter) finish() {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	if tw.closed {
		return
	}
	tw.closed = true
	if tw.w != nil {
		if err := tw.w.Close(); err != nil {
			tw.log.Error("chunk close failed", "err", err)
		}
	}
	tw.meta.EndedAtNs = time.Now().UnixNano()
	tw.meta.Packets = tw.packets.Load()
	tw.meta.Bytes = tw.bytes.Load()
	tw.meta.LostPackets = tw.lost.Load()
	tw.meta.PLIs = tw.plis.Load()
	tw.meta.Chunks = tw.chunkIdx
	if err := dump.WriteMeta(tw.dir, tw.meta); err != nil {
		tw.log.Error("meta write failed", "err", err)
	}
}

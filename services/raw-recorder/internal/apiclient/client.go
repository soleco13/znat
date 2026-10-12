// Package apiclient — клиент внутреннего API Матиса для экспериментальной
// записи (`/api/v1/internal/raw-recorder/*`, Bearer RAW_RECORDER_SECRET).
// Схемы — packages/shared/src/raw-recordings.ts.
package apiclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// ErrLeaseLost — сервер отдал задание другому воркеру или уже завершил его (409).
var ErrLeaseLost = errors.New("lease lost")

// HTTPError — ответ API с кодом ошибки.
type HTTPError struct {
	Status int
	Msg    string
}

func (e *HTTPError) Error() string { return e.Msg }

type Client struct {
	base   string
	secret string
	http   *http.Client
}

func New(baseURL, secret string) *Client {
	return &Client{base: baseURL, secret: secret, http: &http.Client{Timeout: 20 * time.Second}}
}

type Stats struct {
	Tracks           int64 `json:"tracks"`
	Packets          int64 `json:"packets"`
	Bytes            int64 `json:"bytes"`
	LostPackets      int64 `json:"lostPackets"`
	KeyframeRequests int64 `json:"keyframeRequests"`
}

type RecordJob struct {
	RecordingID          string `json:"recordingId"`
	LessonID             string `json:"lessonId"`
	Attempt              int    `json:"attempt"`
	LeaseID              string `json:"leaseId"`
	LivekitURL           string `json:"livekitUrl"`
	LivekitToken         string `json:"livekitToken"`
	AttemptDir           string `json:"attemptDir"`
	MaxDurationSec       int    `json:"maxDurationSec"`
	CameraQuality        string `json:"cameraQuality"`
	ScreenQuality        string `json:"screenQuality"`
	HeartbeatIntervalSec int    `json:"heartbeatIntervalSec"`
}

type RenderJob struct {
	RecordingID      string `json:"recordingId"`
	LessonID         string `json:"lessonId"`
	LeaseID          string `json:"leaseId"`
	Attempt          int    `json:"attempt"`
	RecordingDir     string `json:"recordingDir"`
	OutputKey        string `json:"outputKey"`
	T0Ms             int64  `json:"t0Ms"`
	T1Ms             int64  `json:"t1Ms"`
	ReplayURL        string `json:"replayUrl"`
	Width            int    `json:"width"`
	Height           int    `json:"height"`
	FPS              int    `json:"fps"`
	VideoBitrateKbps int    `json:"videoBitrateKbps"`
}

type JournalEvent struct {
	Seq     int64           `json:"seq"`
	TsMs    int64           `json:"tsMs"`
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload"`
	Data    *string         `json:"data"`
}

type journalPage struct {
	Events       []JournalEvent `json:"events"`
	NextAfterSeq *int64         `json:"nextAfterSeq"`
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) (int, error) {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+c.secret)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 256<<20))
	if resp.StatusCode == http.StatusConflict {
		return resp.StatusCode, ErrLeaseLost
	}
	if resp.StatusCode >= 300 {
		return resp.StatusCode, &HTTPError{Status: resp.StatusCode, Msg: fmt.Sprintf("%s %s: HTTP %d: %s", method, path, resp.StatusCode, truncate(string(data), 300))}
	}
	if out != nil && resp.StatusCode != http.StatusNoContent {
		if err := json.Unmarshal(data, out); err != nil {
			return resp.StatusCode, fmt.Errorf("%s %s: decode: %w", method, path, err)
		}
	}
	return resp.StatusCode, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

const prefix = "/api/v1/internal/raw-recorder"

// Recover — воркер стартовал: сервер возвращает задания прежнего процесса с тем же workerId.
func (c *Client) Recover(ctx context.Context, workerID string) (int, error) {
	var res struct {
		Recovered int `json:"recovered"`
	}
	_, err := c.do(ctx, http.MethodPost, prefix+"/recover", map[string]string{"workerId": workerID}, &res)
	return res.Recovered, err
}

// RecoverWithRetry — то же с повтором, пока API не ответит (старт раньше API — норма).
func (c *Client) RecoverWithRetry(ctx context.Context, workerID string) int {
	for {
		n, err := c.Recover(ctx, workerID)
		if err == nil {
			return n
		}
		var httpErr *HTTPError
		if errors.As(err, &httpErr) && httpErr.Status == http.StatusNotFound {
			return 0 // API без восстановления (старая версия) — работаем как раньше
		}
		select {
		case <-ctx.Done():
			return 0
		case <-time.After(3 * time.Second):
		}
	}
}

// ClaimRecord — взять задание записи; nil — заданий нет.
func (c *Client) ClaimRecord(ctx context.Context, workerID string) (*RecordJob, error) {
	var job RecordJob
	status, err := c.do(ctx, http.MethodPost, prefix+"/record/claim", map[string]string{"workerId": workerID}, &job)
	if err != nil || status == http.StatusNoContent {
		return nil, err
	}
	return &job, nil
}

// RecordHeartbeat — продлить лизу; true — запись остановлена, пора закрывать файлы.
func (c *Client) RecordHeartbeat(ctx context.Context, id, leaseID string, stats Stats) (bool, error) {
	var res struct {
		Stop bool `json:"stop"`
	}
	_, err := c.do(ctx, http.MethodPost, prefix+"/record/"+id+"/heartbeat", map[string]any{"leaseId": leaseID, "stats": stats}, &res)
	return res.Stop, err
}

func (c *Client) RecordFinished(ctx context.Context, id, leaseID, reason string, errText *string, stats Stats) error {
	_, err := c.do(ctx, http.MethodPost, prefix+"/record/"+id+"/finished", map[string]any{
		"leaseId": leaseID, "reason": reason, "error": errText, "stats": stats,
	}, nil)
	return err
}

func (c *Client) ClaimRender(ctx context.Context, workerID string) (*RenderJob, error) {
	var job RenderJob
	status, err := c.do(ctx, http.MethodPost, prefix+"/render/claim", map[string]string{"workerId": workerID}, &job)
	if err != nil || status == http.StatusNoContent {
		return nil, err
	}
	return &job, nil
}

func (c *Client) RenderHeartbeat(ctx context.Context, id, leaseID, step string) error {
	_, err := c.do(ctx, http.MethodPost, prefix+"/render/"+id+"/heartbeat", map[string]string{"leaseId": leaseID, "step": step}, nil)
	return err
}

func (c *Client) RenderFinished(ctx context.Context, id, leaseID string, durationSec float64, sizeBytes int64, metrics map[string]any) error {
	_, err := c.do(ctx, http.MethodPost, prefix+"/render/"+id+"/finished", map[string]any{
		"leaseId": leaseID, "durationSec": durationSec, "sizeBytes": sizeBytes, "metrics": metrics,
	}, nil)
	return err
}

func (c *Client) RenderFailed(ctx context.Context, id, leaseID, errText string, retryable bool) error {
	_, err := c.do(ctx, http.MethodPost, prefix+"/render/"+id+"/failed", map[string]any{
		"leaseId": leaseID, "error": truncate(errText, 3900), "retryable": retryable,
	}, nil)
	return err
}

// Journal — весь журнал записи постранично.
func (c *Client) Journal(ctx context.Context, id string) ([]JournalEvent, error) {
	var all []JournalEvent
	after := int64(0)
	for {
		var page journalPage
		q := url.Values{"afterSeq": {strconv.FormatInt(after, 10)}, "limit": {"5000"}}
		if _, err := c.do(ctx, http.MethodGet, prefix+"/"+id+"/journal?"+q.Encode(), nil, &page); err != nil {
			return nil, err
		}
		all = append(all, page.Events...)
		if page.NextAfterSeq == nil {
			return all, nil
		}
		after = *page.NextAfterSeq
	}
}

package render

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// Минимальный клиент Chrome DevTools Protocol: запустить headless-Chrome,
// открыть страницу, вызвать JS, снять PNG. Без puppeteer/chromedp — та же
// зависимость gorilla/websocket, что уже тянет server-sdk-go.

type Browser struct {
	cmd     *exec.Cmd
	userDir string
	conn    *websocket.Conn
	nextID  atomic.Int64
	mu      sync.Mutex
	pending map[int64]chan cdpReply
	closed  chan struct{}
}

type cdpReply struct {
	Result json.RawMessage
	Err    error
}

// StartBrowser запускает Chrome с окном нужного размера и подключается к первой вкладке.
func StartBrowser(ctx context.Context, chromePath string, width, height int, sandbox bool) (*Browser, error) {
	userDir, err := os.MkdirTemp("", "rawrec-chrome-")
	if err != nil {
		return nil, err
	}
	port, err := freePort()
	if err != nil {
		return nil, err
	}
	args := []string{
		"--headless=new",
		fmt.Sprintf("--remote-debugging-port=%d", port),
		"--remote-debugging-address=127.0.0.1",
		"--user-data-dir=" + userDir,
		fmt.Sprintf("--window-size=%d,%d", width, height),
		"--hide-scrollbars",
		"--mute-audio",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-extensions",
		"--disable-background-networking",
		"--disable-dev-shm-usage",
		"--force-device-scale-factor=1",
		"about:blank",
	}
	if !sandbox {
		// Только своя страница с 127.0.0.1 (RAW_RENDER_REPLAY_ORIGIN); песочницу
		// выключаем, если контейнеру не дали прав на неё (см. compose).
		args = append(args, "--no-sandbox")
	}
	cmd := exec.CommandContext(ctx, chromePath, args...)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		os.RemoveAll(userDir)
		return nil, err
	}
	b := &Browser{cmd: cmd, userDir: userDir, pending: map[int64]chan cdpReply{}, closed: make(chan struct{})}
	wsURL, err := waitPageTarget(ctx, port)
	if err != nil {
		b.Close()
		return nil, err
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		b.Close()
		return nil, err
	}
	conn.SetReadLimit(256 << 20)
	b.conn = conn
	go b.readLoop()
	if _, err := b.Call(ctx, "Page.enable", nil); err != nil {
		b.Close()
		return nil, err
	}
	if _, err := b.Call(ctx, "Emulation.setDeviceMetricsOverride", map[string]any{
		"width": width, "height": height, "deviceScaleFactor": 1, "mobile": false,
	}); err != nil {
		b.Close()
		return nil, err
	}
	return b, nil
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func waitPageTarget(ctx context.Context, port int) (string, error) {
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/json/list", port), nil)
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			var targets []struct {
				Type                 string `json:"type"`
				WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
			}
			_ = json.NewDecoder(resp.Body).Decode(&targets)
			resp.Body.Close()
			for _, t := range targets {
				if t.Type == "page" && t.WebSocketDebuggerURL != "" {
					return t.WebSocketDebuggerURL, nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
	return "", errors.New("chrome devtools did not start")
}

func (b *Browser) readLoop() {
	defer close(b.closed)
	for {
		var msg struct {
			ID     int64           `json:"id"`
			Result json.RawMessage `json:"result"`
			Error  *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := b.conn.ReadJSON(&msg); err != nil {
			b.mu.Lock()
			for id, ch := range b.pending {
				ch <- cdpReply{Err: fmt.Errorf("devtools connection closed: %w", err)}
				delete(b.pending, id)
			}
			b.mu.Unlock()
			return
		}
		if msg.ID == 0 {
			continue // событие
		}
		b.mu.Lock()
		ch := b.pending[msg.ID]
		delete(b.pending, msg.ID)
		b.mu.Unlock()
		if ch == nil {
			continue
		}
		if msg.Error != nil {
			ch <- cdpReply{Err: errors.New(msg.Error.Message)}
		} else {
			ch <- cdpReply{Result: msg.Result}
		}
	}
}

// Call — вызов метода CDP с ожиданием ответа.
func (b *Browser) Call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := b.nextID.Add(1)
	ch := make(chan cdpReply, 1)
	b.mu.Lock()
	b.pending[id] = ch
	b.mu.Unlock()
	b.mu.Lock()
	err := b.conn.WriteJSON(map[string]any{"id": id, "method": method, "params": params})
	b.mu.Unlock()
	if err != nil {
		return nil, err
	}
	select {
	case r := <-ch:
		return r.Result, r.Err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-b.closed:
		return nil, errors.New("devtools connection closed")
	}
}

// Eval — выражение JS (промис дожидается), результат в out.
func (b *Browser) Eval(ctx context.Context, expr string, out any) error {
	raw, err := b.Call(ctx, "Runtime.evaluate", map[string]any{
		"expression": expr, "awaitPromise": true, "returnByValue": true,
	})
	if err != nil {
		return err
	}
	var res struct {
		Result struct {
			Value json.RawMessage `json:"value"`
		} `json:"result"`
		ExceptionDetails *struct {
			Text      string `json:"text"`
			Exception *struct {
				Description string `json:"description"`
			} `json:"exception"`
		} `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return err
	}
	if res.ExceptionDetails != nil {
		msg := res.ExceptionDetails.Text
		if res.ExceptionDetails.Exception != nil {
			msg = res.ExceptionDetails.Exception.Description
		}
		return fmt.Errorf("js: %s", strings.TrimSpace(msg))
	}
	if out == nil || len(res.Result.Value) == 0 {
		return nil
	}
	return json.Unmarshal(res.Result.Value, out)
}

func (b *Browser) Navigate(ctx context.Context, url string) error {
	_, err := b.Call(ctx, "Page.navigate", map[string]any{"url": url})
	return err
}

// ScreenshotPNG — снимок области просмотра.
func (b *Browser) ScreenshotPNG(ctx context.Context) ([]byte, error) {
	raw, err := b.Call(ctx, "Page.captureScreenshot", map[string]any{"format": "png", "fromSurface": true})
	if err != nil {
		return nil, err
	}
	var res struct {
		Data []byte `json:"data"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, err
	}
	return res.Data, nil
}

func (b *Browser) Close() {
	if b.conn != nil {
		b.conn.Close()
	}
	if b.cmd != nil && b.cmd.Process != nil {
		_ = b.cmd.Process.Kill()
		_ = b.cmd.Wait()
	}
	os.RemoveAll(b.userDir)
}

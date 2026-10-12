package render

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Проверка MP4 перед публикацией на настоящем ffmpeg. Нужен ffmpeg в PATH —
// запускать собранный `go test -c` внутри образа рекордера:
//
//	RAWREC_FFMPEG_IT=1 /tmp/render.test -test.run Verify
func TestVerifyRejectsBrokenOutputs(t *testing.T) {
	if os.Getenv("RAWREC_FFMPEG_IT") == "" {
		t.Skip("RAWREC_FFMPEG_IT не задан")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	dir := t.TempDir()
	var cpu time.Duration
	mk := func(name string, args ...string) string {
		out := filepath.Join(dir, name)
		base := []string{"-nostdin", "-y", "-loglevel", "error"}
		if _, err := runTool(ctx, &cpu, "ffmpeg", append(append(base, args...), out)...); err != nil {
			t.Fatal(err)
		}
		return out
	}
	good := mk("good.mp4", "-f", "lavfi", "-i", "testsrc=s=320x240:r=24:d=10", "-f", "lavfi", "-i", "sine=d=10",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart")
	if _, err := verifyOutput(ctx, &cpu, good, 10, 320, 240); err != nil {
		t.Fatalf("good file rejected: %v", err)
	}
	if _, err := verifyOutput(ctx, &cpu, good, 30, 320, 240); err == nil {
		t.Error("wrong duration accepted")
	}
	if _, err := verifyOutput(ctx, &cpu, good, 10, 1280, 720); err == nil {
		t.Error("wrong size accepted")
	}
	silent := mk("silent.mp4", "-f", "lavfi", "-i", "testsrc=s=320x240:r=24:d=10", "-c:v", "libx264", "-pix_fmt", "yuv420p")
	if _, err := verifyOutput(ctx, &cpu, silent, 10, 320, 240); err == nil {
		t.Error("file without audio accepted")
	}
	// Недописанный файл (рендер упал при записи): обрезан на 60 %.
	data, _ := os.ReadFile(good)
	truncated := filepath.Join(dir, "truncated.mp4")
	_ = os.WriteFile(truncated, data[:len(data)*6/10], 0o644)
	if _, err := verifyOutput(ctx, &cpu, truncated, 10, 320, 240); err == nil {
		t.Error("truncated file accepted")
	}
	// Испорченная середина: мусор вместо части данных.
	corrupt := append([]byte(nil), data...)
	for i := len(corrupt) / 2; i < len(corrupt)/2+20000 && i < len(corrupt); i++ {
		corrupt[i] = byte(i * 7)
	}
	corruptPath := filepath.Join(dir, "corrupt.mp4")
	_ = os.WriteFile(corruptPath, corrupt, 0o644)
	if _, err := verifyOutput(ctx, &cpu, corruptPath, 10, 320, 240); err == nil {
		t.Error("corrupted file accepted")
	}
}

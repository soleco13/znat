package render

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// PlayCheck — открыть MP4 в <video> headless-Chrome и проиграть несколько
// секунд с начала и с середины: проверка, что браузер на Chromium файл
// понимает (кодек, контейнер, moov в начале). Отладочная команда `rawrec playcheck`.
func PlayCheck(ctx context.Context, chromePath, mp4 string, sandbox bool) (map[string]any, error) {
	abs, err := filepath.Abs(mp4)
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "playcheck-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	page := filepath.Join(dir, "p.html")
	html := fmt.Sprintf(`<!doctype html><video id=v muted playsinline src="file://%s"></video>`, abs)
	if err := os.WriteFile(page, []byte(html), 0o644); err != nil {
		return nil, err
	}
	b, err := StartBrowser(ctx, chromePath, 640, 360, sandbox)
	if err != nil {
		return nil, err
	}
	defer b.Close()
	if err := b.Navigate(ctx, "file://"+page); err != nil {
		return nil, err
	}
	var res map[string]any
	js := `new Promise((resolve) => {
  const v = document.getElementById("v");
  const out = {};
  const fail = () => resolve({error: v.error ? v.error.code + " " + v.error.message : "timeout", readyState: v.readyState});
  const t = setTimeout(fail, 30000);
  v.onerror = () => { clearTimeout(t); fail(); };
  const run = async () => {
    await v.play();
    await new Promise(r => setTimeout(r, 3000));
    out.startPlayedTo = v.currentTime;
    v.currentTime = v.duration / 2;
    await new Promise(r => v.onseeked = r);
    const before = v.currentTime;
    await new Promise(r => setTimeout(r, 3000));
    out.middleAdvanced = v.currentTime - before;
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {};
    Object.assign(out, {duration: v.duration, width: v.videoWidth, height: v.videoHeight,
      decodedFrames: q.totalVideoFrames, droppedFrames: q.droppedVideoFrames, error: v.error ? v.error.code : null});
    clearTimeout(t); resolve(out);
  };
  if (v.readyState >= 1) run(); else v.onloadedmetadata = run;
})`
	if err := b.Eval(ctx, js, &res); err != nil {
		return nil, err
	}
	return res, nil
}

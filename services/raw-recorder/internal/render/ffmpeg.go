package render

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"matis/raw-recorder/internal/convert"
)

// runTool — запуск ffmpeg/ffprobe с учётом CPU-времени процесса (метрики).
func runTool(ctx context.Context, cpu *time.Duration, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if cmd.ProcessState != nil && cpu != nil {
		if ru, ok := cmd.ProcessState.SysUsage().(*syscall.Rusage); ok {
			*cpu += time.Duration(ru.Utime.Nano() + ru.Stime.Nano())
		}
	}
	if err != nil {
		tail := stderr.String()
		if len(tail) > 1500 {
			tail = tail[len(tail)-1500:]
		}
		return nil, fmt.Errorf("%s: %w: %s", name, err, strings.TrimSpace(tail))
	}
	return stdout.Bytes(), nil
}

// sliceIVF — кусок IVF для сегмента: от последнего ключевого кадра не позже
// startMs (декодеру нужен опорный кадр) до первого кадра после endMs.
// Кадры до startMs декодируются и отбрасываются фильтром trim.
func sliceIVF(src string, track convert.Track, startMs, endMs int64, dst string) (bool, error) {
	if len(track.Keyframes) == 0 {
		return false, nil
	}
	// Допуск на округление начала сегмента до кадра: сегмент, начатый сменой
	// пропорций, должен брать именно этот ключевой кадр, а не прежний.
	from := track.Keyframes[0]
	for _, k := range track.Keyframes {
		if k.PtsMs <= startMs+keyframeSlackMs {
			from = k
		}
	}
	if from.PtsMs > endMs {
		return false, nil
	}
	in, err := os.Open(src)
	if err != nil {
		return false, err
	}
	defer in.Close()
	hdr := make([]byte, 32)
	if _, err := io.ReadFull(in, hdr); err != nil {
		return false, err
	}
	if _, err := in.Seek(from.Offset, io.SeekStart); err != nil {
		return false, err
	}
	out, err := os.Create(dst)
	if err != nil {
		return false, err
	}
	defer out.Close()
	if _, err := out.Write(hdr); err != nil {
		return false, err
	}
	frames := uint32(0)
	fh := make([]byte, 12)
	for {
		if _, err := io.ReadFull(in, fh); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				break
			}
			return false, err
		}
		size := binary.LittleEndian.Uint32(fh[0:4])
		pts := int64(binary.LittleEndian.Uint64(fh[4:12]))
		if pts > endMs+1000 {
			break
		}
		data := make([]byte, size)
		if _, err := io.ReadFull(in, data); err != nil {
			return false, err
		}
		if _, err := out.Write(fh); err != nil {
			return false, err
		}
		if _, err := out.Write(data); err != nil {
			return false, err
		}
		frames++
	}
	var n [4]byte
	binary.LittleEndian.PutUint32(n[:], frames)
	if _, err := out.WriteAt(n[:], 24); err != nil {
		return false, err
	}
	return frames > 0, out.Sync()
}

const keyframeSlackMs = 40

// Frame — кадр главной области (PNG страницы кадров) с момента AtMs.
type Frame struct {
	AtMs int64
	Path string
}

type segmentParams struct {
	Seg        Segment
	Geometry   Geometry
	FPS        int
	FrameStart int64 // номер первого кадра сегмента на общей шкале
	FrameCount int64
	BitrateKb  int
	TracksDir  string
	WorkDir    string
	Tracks     map[string]convert.Track
	Frames     []Frame // кадры главной области (доска/задание), по возрастанию
	FontFile   string
}

// renderSegment — один сегмент с постоянной раскладкой в H.264 без звука.
// Все сегменты кодируются одинаково, поэтому склеиваются без перекодирования.
func renderSegment(ctx context.Context, cpu *time.Duration, p segmentParams, out string) error {
	g := p.Geometry
	fps := float64(p.FPS)
	startMs := int64(math.Round(float64(p.FrameStart) * 1000 / fps))
	durSec := float64(p.FrameCount) / fps
	endMs := startMs + int64(math.Ceil(durSec*1000))
	// -copyts: метки входов как в файлах (мс от начала шкалы записи). Без него
	// ffmpeg сдвигает каждый вход к нулю от его первого кадра — кусок камеры,
	// начатый с ключевого кадра, и звук, начатый не с нуля, съезжали (замер
	// «хлопушкой» 2026-10-12: звук отставал на ~850 мс).
	args := []string{"-nostdin", "-y", "-loglevel", "error", "-copyts",
		"-f", "lavfi", "-i", fmt.Sprintf("color=c=0x000000:s=%dx%d:r=%d:d=%.6f", g.W, g.H, p.FPS, durSec)}
	var filters []string
	inputs := 1
	cur := "[0:v]format=yuv420p"
	// Фон плиток (заглушка без видео — тёмная плитка с именем, как в живом уроке).
	for _, t := range p.Seg.Tiles {
		cur += fmt.Sprintf(",drawbox=x=%d:y=%d:w=%d:h=%d:color=0x101828:t=fill", t.Rect.X, t.Rect.Y, t.Rect.W, t.Rect.H)
	}
	if p.Seg.Main != MainNone {
		m := g.Main
		cur += fmt.Sprintf(",drawbox=x=%d:y=%d:w=%d:h=%d:color=white:t=fill", m.X, m.Y, m.W, m.H)
	}
	label := "b0"
	filters = append(filters, cur+"["+label+"]")
	next := func() string { inputs++; return fmt.Sprintf("b%d", inputs) }

	// Главная область: кадры доски/задания из страницы кадров.
	if (p.Seg.Main == MainBoard || p.Seg.Main == MainActivity) && len(p.Frames) > 0 {
		list := filepath.Join(p.WorkDir, "main-frames.txt")
		if err := writeConcatList(list, p.Frames, startMs, endMs); err != nil {
			return err
		}
		args = append(args, "-f", "concat", "-safe", "0", "-i", list)
		idx := inputs
		lbl := next()
		filters = append(filters,
			fmt.Sprintf("[%d:v]scale=%d:%d,format=yuv420p,setpts=PTS-STARTPTS[mf%d]", idx, g.Main.W, g.Main.H, idx),
			fmt.Sprintf("[%s][mf%d]overlay=%d:%d:eof_action=repeat[%s]", label, idx, g.Main.X, g.Main.Y, lbl))
		label = lbl
	}
	// Демонстрация экрана — целиком, по центру (как object-fit: contain).
	if p.Seg.Main == MainScreen {
		if t, ok := p.Tracks[p.Seg.Screen]; ok {
			slice := filepath.Join(p.WorkDir, "screen.ivf")
			has, err := sliceIVF(filepath.Join(p.TracksDir, t.File), t, startMs, endMs, slice)
			if err != nil {
				return err
			}
			if has {
				args = append(args, videoInput(slice)...)
				idx := inputs
				lbl := next()
				m := g.Main
				filters = append(filters,
					fmt.Sprintf("[%d:v]setpts=PTS-%d/1000/TB,trim=start=0,scale=%d:%d:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p[sc%d]",
						idx, startMs, m.W, m.H, m.W, m.H, idx),
					fmt.Sprintf("[%s][sc%d]overlay=%d:%d:eof_action=repeat[%s]", label, idx, m.X, m.Y, lbl))
				label = lbl
			}
		}
	}
	// Камеры — заполняют плитку (как object-fit: cover).
	for i, tile := range p.Seg.Tiles {
		if tile.Video == "" {
			continue
		}
		t, ok := p.Tracks[tile.Video]
		if !ok {
			continue
		}
		slice := filepath.Join(p.WorkDir, fmt.Sprintf("cam-%02d.ivf", i))
		has, err := sliceIVF(filepath.Join(p.TracksDir, t.File), t, startMs, endMs, slice)
		if err != nil {
			return err
		}
		if !has {
			continue
		}
		args = append(args, videoInput(slice)...)
		idx := inputs
		lbl := next()
		r := tile.Rect
		filters = append(filters,
			fmt.Sprintf("[%d:v]setpts=PTS-%d/1000/TB,trim=start=0,scale=%d:%d:force_original_aspect_ratio=increase:force_divisible_by=2,crop=%d:%d,format=yuv420p[cam%d]",
				idx, startMs, r.W, r.H, r.W, r.H, idx),
			fmt.Sprintf("[%s][cam%d]overlay=%d:%d:eof_action=repeat[%s]", label, idx, r.X, r.Y, lbl))
		label = lbl
	}
	// Имена поверх плиток.
	names := []string{}
	fontSize := int(math.Max(11, float64(g.W)/1280*12))
	for i, tile := range p.Seg.Tiles {
		nameFile := filepath.Join(p.WorkDir, fmt.Sprintf("name-%02d.txt", i))
		if err := os.WriteFile(nameFile, []byte(truncateName(tile.Name, tile.Rect.W/(fontSize*6/10))), 0o644); err != nil {
			return err
		}
		names = append(names, fmt.Sprintf("drawtext=fontfile=%s:textfile=%s:fontsize=%d:fontcolor=white:box=1:boxcolor=0x101828@0.72:boxborderw=5:x=%d:y=%d",
			p.FontFile, nameFile, fontSize, tile.Rect.X+8, tile.Rect.Y+tile.Rect.H-fontSize-12))
	}
	if p.Seg.Hidden > 0 && len(p.Seg.Tiles) > 0 {
		last := p.Seg.Tiles[len(p.Seg.Tiles)-1].Rect
		moreFile := filepath.Join(p.WorkDir, "more.txt")
		if err := os.WriteFile(moreFile, []byte(fmt.Sprintf("ещё %d", p.Seg.Hidden)), 0o644); err != nil {
			return err
		}
		names = append(names, fmt.Sprintf("drawtext=fontfile=%s:textfile=%s:fontsize=%d:fontcolor=white:box=1:boxcolor=0x101828@0.9:boxborderw=6:x=%d:y=%d",
			p.FontFile, moreFile, fontSize+1, last.X+8, last.Y+last.H+g.TileGap+4))
	}
	final := fmt.Sprintf("[%s]", label)
	if len(names) > 0 {
		final += strings.Join(names, ",") + ","
	} else {
		final += "null,"
	}
	final += fmt.Sprintf("fps=%d,trim=end_frame=%d[out]", p.FPS, p.FrameCount)
	filters = append(filters, final)
	args = append(args,
		"-filter_complex", strings.Join(filters, ";"),
		"-map", "[out]",
		"-frames:v", strconv.FormatInt(p.FrameCount, 10),
		"-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
		"-crf", "23", "-maxrate", fmt.Sprintf("%dk", p.BitrateKb), "-bufsize", fmt.Sprintf("%dk", p.BitrateKb*2),
		"-g", strconv.Itoa(p.FPS*2), "-r", strconv.Itoa(p.FPS),
		"-threads", "2",
		"-an", "-f", "mp4", out)
	// Команда — в рабочий каталог сегмента: при сбое он остаётся для разбора.
	_ = os.WriteFile(filepath.Join(p.WorkDir, "ffmpeg-args.json"), mustJSON(args), 0o644)
	_, err := runTool(ctx, cpu, "ffmpeg", args...)
	return err
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// videoInput — вход дорожки камеры/демонстрации. Слой simulcast меняется на
// ходу (и в начале дорожки: первый ключевой кадр часто из нижнего слоя) —
// по умолчанию ffmpeg на смене размера кадра пересоздаёт весь граф и теряет
// согласование времени со входами (замер 2026-10-12: видео раньше звука на
// ~300 мс). -reinit_filter 0: смену размера переваривает сам scale.
func videoInput(path string) []string {
	return []string{"-reinit_filter", "0", "-i", path}
}

func truncateName(name string, maxChars int) string {
	r := []rune(name)
	if maxChars < 4 {
		maxChars = 4
	}
	if len(r) <= maxChars {
		return name
	}
	return string(r[:maxChars-1]) + "…"
}

// writeConcatList — список concat-демультиплексора: кадр держится до следующего.
func writeConcatList(path string, frames []Frame, startMs, endMs int64) error {
	var b strings.Builder
	b.WriteString("ffconcat version 1.0\n")
	var cur *Frame
	for i := range frames {
		if frames[i].AtMs <= startMs {
			cur = &frames[i]
		}
	}
	if cur == nil {
		cur = &frames[0]
	}
	at := startMs
	emit := func(f *Frame, until int64) {
		if until <= at {
			return
		}
		fmt.Fprintf(&b, "file '%s'\nduration %.3f\n", f.Path, float64(until-at)/1000)
		at = until
	}
	for i := range frames {
		f := &frames[i]
		if f.AtMs <= startMs || f.AtMs >= endMs {
			continue
		}
		emit(cur, f.AtMs)
		cur = f
	}
	emit(cur, endMs)
	// Особенность concat: длительность последнего файла учитывается, только если он повторён.
	fmt.Fprintf(&b, "file '%s'\n", cur.Path)
	return os.WriteFile(path, []byte(b.String()), 0o644)
}

// mixAudio — все микрофоны (и звук демонстрации) на одну шкалу и в AAC.
func mixAudio(ctx context.Context, cpu *time.Duration, files []string, durSec float64, out string) error {
	args := []string{"-nostdin", "-y", "-loglevel", "error", "-copyts"}
	if len(files) == 0 {
		args = append(args, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
			"-t", fmt.Sprintf("%.6f", durSec), "-c:a", "aac", "-b:a", "128k", out)
		_, err := runTool(ctx, cpu, "ffmpeg", args...)
		return err
	}
	var filters []string
	var mix strings.Builder
	for i, f := range files {
		args = append(args, "-i", f)
		// first_pts=0 — тишина до начала дорожки; async — тишина в паузах (гранулы Ogg).
		filters = append(filters, fmt.Sprintf("[%d:a]aresample=48000:async=1000:first_pts=0,aformat=channel_layouts=stereo[a%d]", i, i))
		fmt.Fprintf(&mix, "[a%d]", i)
	}
	filters = append(filters, fmt.Sprintf("%samix=inputs=%d:normalize=0:dropout_transition=0,alimiter=limit=0.95,apad,atrim=0:%.6f[out]", mix.String(), len(files), durSec))
	args = append(args, "-filter_complex", strings.Join(filters, ";"), "-map", "[out]", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", out)
	_, err := runTool(ctx, cpu, "ffmpeg", args...)
	return err
}

// concatAndMux — склейка сегментов без перекодирования + звук, moov в начале (просмотр по сети).
func concatAndMux(ctx context.Context, cpu *time.Duration, segments []string, audio, listPath, out string) error {
	var b strings.Builder
	b.WriteString("ffconcat version 1.0\n")
	for _, s := range segments {
		fmt.Fprintf(&b, "file '%s'\n", s)
	}
	if err := os.WriteFile(listPath, []byte(b.String()), 0o644); err != nil {
		return err
	}
	_, err := runTool(ctx, cpu, "ffmpeg", "-nostdin", "-y", "-loglevel", "error",
		"-f", "concat", "-safe", "0", "-i", listPath, "-i", audio,
		"-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", "-f", "mp4", out)
	return err
}

// Probe — то, что проверяем у готового MP4.
type Probe struct {
	DurationSec float64
	Video       string
	Audio       string
	Width       int
	Height      int
}

func probe(ctx context.Context, cpu *time.Duration, path string) (Probe, error) {
	raw, err := runTool(ctx, cpu, "ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path)
	if err != nil {
		return Probe{}, err
	}
	var res struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
		Streams []struct {
			CodecType string `json:"codec_type"`
			CodecName string `json:"codec_name"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return Probe{}, err
	}
	p := Probe{}
	p.DurationSec, _ = strconv.ParseFloat(res.Format.Duration, 64)
	for _, s := range res.Streams {
		switch s.CodecType {
		case "video":
			p.Video, p.Width, p.Height = s.CodecName, s.Width, s.Height
		case "audio":
			p.Audio = s.CodecName
		}
	}
	return p, nil
}

// verifyOutput — MP4 годится к публикации: H.264 + AAC нужного размера,
// длительность совпадает с шкалой, начало/середина/конец декодируются без ошибок.
func verifyOutput(ctx context.Context, cpu *time.Duration, path string, wantSec float64, w, h int) (Probe, error) {
	p, err := probe(ctx, cpu, path)
	if err != nil {
		return p, err
	}
	if p.Video != "h264" || p.Audio != "aac" {
		return p, fmt.Errorf("unexpected streams: video=%q audio=%q", p.Video, p.Audio)
	}
	if p.Width != w || p.Height != h {
		return p, fmt.Errorf("unexpected size %dx%d", p.Width, p.Height)
	}
	if math.Abs(p.DurationSec-wantSec) > math.Max(1.5, wantSec*0.002) {
		return p, fmt.Errorf("duration %.2fs, expected %.2fs", p.DurationSec, wantSec)
	}
	for _, at := range []float64{0, wantSec / 2, math.Max(0, wantSec-3)} {
		// -xerror: любая ошибка декодирования — ненулевой код выхода.
		if _, err := runTool(ctx, cpu, "ffmpeg", "-nostdin", "-v", "error", "-xerror", "-ss", fmt.Sprintf("%.3f", at), "-i", path, "-t", "2", "-f", "null", "-"); err != nil {
			return p, fmt.Errorf("decode at %.1fs: %w", at, err)
		}
	}
	return p, nil
}

package convert

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pion/rtp"
	"github.com/pion/rtp/codecs"

	"matis/raw-recorder/internal/dump"
)

// Interval — отрезок шкалы записи, мс от t0.
type Interval struct {
	StartMs int64 `json:"startMs"`
	EndMs   int64 `json:"endMs"`
}

// Keyframe — ключевой кадр IVF: время и смещение заголовка кадра в файле.
type Keyframe struct {
	PtsMs  int64 `json:"ptsMs"`
	Offset int64 `json:"offset"`
}

// Track — результат конвертации одной дорожки.
type Track struct {
	Key         string     `json:"key"`
	Attempt     int        `json:"attempt"`
	Identity    string     `json:"identity"`
	Name        string     `json:"name"`
	Source      string     `json:"source"`
	Kind        string     `json:"kind"`
	MimeType    string     `json:"mimeType"`
	File        string     `json:"file,omitempty"`
	Supported   bool       `json:"supported"`
	StartMs     int64      `json:"startMs"`
	EndMs       int64      `json:"endMs"`
	Packets     int        `json:"packets"`
	Duplicates  int        `json:"duplicates"`
	LostPackets int        `json:"lostPackets"`
	Frames      int        `json:"frames"`
	Keyframes   []Keyframe `json:"keyframes,omitempty"`
	Dropped     int        `json:"droppedFrames"`
	Width       uint16     `json:"width,omitempty"`
	Height      uint16     `json:"height,omitempty"`
	Active      []Interval `json:"active"`
	TimingRuns  int        `json:"timingRuns"`
	DriftPPM    float64    `json:"driftPpm"`
	LagP50Ms    float64    `json:"arrivalLagP50Ms"`
	LagP99Ms    float64    `json:"arrivalLagP99Ms"`
	LagMinMs    float64    `json:"arrivalLagMinMs"`
	Truncated   bool       `json:"truncatedChunk"`
	// AspectChanges — моменты (мс), с которых меняются пропорции кадра (поворот
	// телефона, другое окно в демонстрации): рендер режет по ним сегменты,
	// чтобы внутри сегмента размер кадра после масштабирования был постоянным.
	AspectChanges []int64 `json:"aspectChanges,omitempty"`
	// TinyDropped — служебные кадры SFU размером в несколько пикселей (8×8) и зависящие от них.
	TinyDropped int `json:"tinyDropped"`
	// TrailingDropped — отброшенный хвост служебных кадров SFU (см. keepBeforeTrailingBurst).
	TrailingDropped int `json:"trailingDropped"`
}

// Index — все дорожки записи (render/tracks/index.json).
type Index struct {
	T0Ms   int64   `json:"t0Ms"`
	Tracks []Track `json:"tracks"`
}

// activeGapMs — пауза в кадрах/пакетах длиннее этого — дорожка «выключена» (камера, микрофон).
const activeGapMs = 2000

// ConvertRecording конвертирует все дорожки всех попыток записи в outDir.
// Повторный вызов с готовым index.json ничего не делает (контрольная точка).
func ConvertRecording(recordingDir, outDir string, t0Ms int64) (*Index, error) {
	indexPath := filepath.Join(outDir, "index.json")
	if data, err := os.ReadFile(indexPath); err == nil {
		var idx Index
		if json.Unmarshal(data, &idx) == nil && idx.T0Ms == t0Ms {
			return &idx, nil
		}
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return nil, err
	}
	attempts, _ := filepath.Glob(filepath.Join(recordingDir, "attempt-*"))
	sort.Strings(attempts)
	idx := &Index{T0Ms: t0Ms}
	for _, attemptDir := range attempts {
		entries, err := os.ReadDir(attemptDir)
		if err != nil {
			return nil, err
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			dir := filepath.Join(attemptDir, e.Name())
			meta, err := dump.ReadMeta(dir)
			if err != nil {
				continue // каталог без track.json — не дорожка
			}
			track, err := convertTrack(dir, outDir, meta, t0Ms)
			if err != nil {
				return nil, fmt.Errorf("track %s: %w", meta.Key, err)
			}
			if track != nil {
				idx.Tracks = append(idx.Tracks, *track)
			}
		}
	}
	data, _ := json.MarshalIndent(idx, "", "  ")
	if err := dump.WriteFileAtomic(indexPath, data); err != nil {
		return nil, err
	}
	return idx, nil
}

type packet struct {
	ext       int64 // расширенный номер пакета
	ts        int64 // расширенное время RTP
	arrivalNs int64
	pid       int // номер в порядке прихода (= point.id)
	pkt       rtp.Packet
}

// readPackets — все RTP-пакеты дорожки по порядку номеров, без дублей.
func readPackets(dir string) ([]packet, []point, bool, error) {
	chunks, err := dump.ListChunks(dir)
	if err != nil {
		return nil, nil, false, err
	}
	var pkts []packet
	var points []point
	var seqU, tsU unwrapper
	truncated := false
	for _, c := range chunks {
		recs, err := dump.ReadChunk(c)
		if errors.Is(err, dump.ErrTruncated) {
			truncated = true
		} else if err != nil {
			return nil, nil, false, err
		}
		for _, r := range recs {
			if r.Type != dump.RecordRTP {
				continue
			}
			var p rtp.Packet
			if err := p.Unmarshal(r.Data); err != nil {
				continue
			}
			ts := tsU.next(p.Timestamp)
			ext := seqU.next16(p.SequenceNumber)
			pid := len(pkts)
			pkts = append(pkts, packet{ext: ext, ts: ts, arrivalNs: r.ArrivalNs, pid: pid, pkt: p})
			points = append(points, point{ext: ts, arrivalNs: r.ArrivalNs, id: pid})
		}
	}
	sort.SliceStable(pkts, func(i, j int) bool { return pkts[i].ext < pkts[j].ext })
	return pkts, points, truncated, nil
}

func (u *unwrapper) next16(seq uint16) int64 {
	if !u.have {
		u.have, u.last, u.ext = true, uint32(seq), int64(seq)
		return u.ext
	}
	u.ext += int64(int16(seq - uint16(u.last)))
	u.last = uint32(seq)
	return u.ext
}

func dedupe(pkts []packet) ([]packet, int) {
	out := pkts[:0]
	dups := 0
	for i, p := range pkts {
		if i > 0 && p.ext == pkts[i-1].ext {
			dups++
			continue
		}
		out = append(out, p)
	}
	return out, dups
}

func convertTrack(dir, outDir string, meta dump.TrackMeta, t0Ms int64) (*Track, error) {
	pkts, points, truncated, err := readPackets(dir)
	if err != nil {
		return nil, err
	}
	track := &Track{
		Key: meta.Key, Attempt: meta.Attempt, Identity: meta.Identity, Name: meta.Name,
		Source: meta.Source, Kind: meta.Kind, MimeType: meta.MimeType, Truncated: truncated,
	}
	if len(pkts) == 0 {
		return track, nil
	}
	pkts, track.Duplicates = dedupe(pkts)
	track.Packets = len(pkts)
	track.LostPackets = int(pkts[len(pkts)-1].ext-pkts[0].ext+1) - len(pkts)
	// Отображение строится по точкам в порядке прихода.
	sort.Slice(points, func(i, j int) bool { return points[i].arrivalNs < points[j].arrivalNs })
	mapper := BuildMapper(points, meta.ClockRate)
	track.TimingRuns = mapper.Runs()
	track.DriftPPM = round1(mapper.DriftPPM())
	p50, p99, _, minLag := LagStats(mapper, points)
	track.LagP50Ms, track.LagP99Ms, track.LagMinMs = round1(p50), round1(p99), round1(minLag)
	relMs := func(p packet) int64 { return mapper.HostNsFor(point{ext: p.ts, id: p.pid})/1e6 - t0Ms }

	mime := strings.ToLower(meta.MimeType)
	switch {
	case mime == "video/vp8":
		track.Supported = true
		track.File = meta.Key + ".ivf"
		err = writeVP8(pkts, filepath.Join(outDir, track.File), relMs, track)
	case mime == "audio/opus":
		track.Supported = true
		track.File = meta.Key + ".ogg"
		err = writeOpus(pkts, filepath.Join(outDir, track.File), relMs, track)
	default:
		// VP9/H.264/AV1 рекордер пишет как есть, но сборка пока только VP8/Opus.
		track.Supported = false
	}
	return track, err
}

// minFrameSide — кадр меньше этого по любой стороне — служебный кадр SFU.
const minFrameSide = 32

// sameAspect — пропорции совпадают с точностью 2 % (слои simulcast одного
// источника отличаются только масштабом).
func sameAspect(w1, h1, w2, h2 uint16) bool {
	a := float64(w1) / float64(h1)
	b := float64(w2) / float64(h2)
	return a/b > 0.98 && a/b < 1.02
}

type frame struct {
	ptsMs int64
	key   bool
	data  []byte
}

// writeVP8 — кадры VP8 из пакетов. Кадр целый, если номера пакетов подряд,
// первый пакет начинает раздел 0 (S=1, PID=0), последний с маркером. После
// потери (неполный кадр, пропавший кадр) — пропуск до ключевого кадра:
// декодер не должен получить кадр со сломанной ссылкой.
func writeVP8(pkts []packet, path string, relMs func(packet) int64, track *Track) error {
	var frames []frame
	needKey := true
	var prevLastExt int64 = -1
	var curW, curH uint16
	i := 0
	for i < len(pkts) {
		j := i
		for j+1 < len(pkts) && pkts[j+1].ts == pkts[i].ts {
			j++
		}
		group := pkts[i : j+1]
		i = j + 1
		complete := group[len(group)-1].pkt.Marker
		for k := 1; k < len(group) && complete; k++ {
			if group[k].ext != group[k-1].ext+1 {
				complete = false
			}
		}
		var data []byte
		if complete {
			for k, p := range group {
				var vp8 codecs.VP8Packet
				payload, err := vp8.Unmarshal(p.pkt.Payload)
				if err != nil {
					complete = false
					break
				}
				if k == 0 && (vp8.S != 1 || vp8.PID != 0) {
					complete = false
					break
				}
				data = append(data, payload...)
			}
		}
		contiguous := prevLastExt < 0 || group[0].ext == prevLastExt+1
		prevLastExt = group[len(group)-1].ext
		if !complete || len(data) == 0 {
			needKey = true
			track.Dropped++
			continue
		}
		key := data[0]&0x01 == 0
		if !contiguous && !key {
			needKey = true
		}
		if needKey && !key {
			track.Dropped++
			continue
		}
		if key && len(data) >= 10 && data[3] == 0x9d && data[4] == 0x01 && data[5] == 0x2a {
			w := uint16(data[6]) | uint16(data[7]&0x3f)<<8
			h := uint16(data[8]) | uint16(data[9]&0x3f)<<8
			if w < minFrameSide || h < minFrameSide {
				// «Пустой» кадр SFU (LiveKit шлёт 8×8 при паузе/смене слоя) — не изображение.
				needKey = true
				track.TinyDropped++
				continue
			}
			pts := relMs(group[0])
			if curW != 0 && !sameAspect(curW, curH, w, h) {
				track.AspectChanges = append(track.AspectChanges, pts)
			}
			curW, curH = w, h
			if track.Width == 0 {
				track.Width, track.Height = w, h
			}
		}
		needKey = false
		frames = append(frames, frame{ptsMs: relMs(group[0]), key: key, data: data})
	}
	// Служебные кадры SFU при закрытии дорожки (LiveKit шлёт «пустые» кадры
	// с продолжением старых меток) — короткий хвост после долгой паузы.
	keep := keepBeforeTrailingBurst(len(frames), func(k int) int64 { return frames[k].ptsMs })
	track.TrailingDropped = len(frames) - keep
	frames = frames[:keep]
	if len(frames) == 0 {
		return nil
	}
	// Метки только растут: погрешность отображения не должна переставлять кадры.
	for k := 1; k < len(frames); k++ {
		if frames[k].ptsMs <= frames[k-1].ptsMs {
			frames[k].ptsMs = frames[k-1].ptsMs + 1
		}
	}
	w, err := createIVF(path, track.Width, track.Height)
	if err != nil {
		return err
	}
	offset := int64(32)
	for _, f := range frames {
		if f.key {
			track.Keyframes = append(track.Keyframes, Keyframe{PtsMs: f.ptsMs, Offset: offset})
		}
		if err := w.writeFrame(f.ptsMs, f.data); err != nil {
			w.f.Close()
			return err
		}
		offset += 12 + int64(len(f.data))
	}
	track.Frames = len(frames)
	track.StartMs = frames[0].ptsMs
	track.EndMs = frames[len(frames)-1].ptsMs
	track.Active = activeIntervals(len(frames), func(k int) int64 { return frames[k].ptsMs }, 100)
	return w.close()
}

func writeOpus(pkts []packet, path string, relMs func(packet) int64, track *Track) error {
	w, err := createOggOpus(path, 2)
	if err != nil {
		return err
	}
	keep := keepBeforeTrailingBurst(len(pkts), func(k int) int64 { return pkts[k].arrivalNs / 1e6 })
	track.TrailingDropped = len(pkts) - keep
	pkts = pkts[:keep]
	var times []int64
	for _, p := range pkts {
		samples := opusSamples(p.pkt.Payload)
		if samples == 0 {
			continue
		}
		startMs := relMs(p)
		if startMs < 0 {
			continue // до начала шкалы записи
		}
		if err := w.writePacket(startMs*48, samples, p.pkt.Payload); err != nil {
			w.f.Close()
			return err
		}
		times = append(times, startMs)
	}
	track.Frames = w.packets
	if len(times) > 0 {
		track.StartMs = times[0]
		track.EndMs = times[len(times)-1]
		track.Active = activeIntervals(len(times), func(k int) int64 { return times[k] }, 20)
	}
	return w.close()
}

func round1(v float64) float64 { return float64(int64(v*10+0.5*sign(v))) / 10 }

func sign(v float64) float64 {
	if v < 0 {
		return -1
	}
	return 1
}

// keepBeforeTrailingBurst — сколько элементов оставить: хвост короче 1 с
// после паузы длиннее 5 с в самом конце дорожки — служебные кадры SFU при
// закрытии дорожки (видно на тестовом уроке: ~0,3 с чёрного кадра спустя
// 47 с после падения участника), не речь и не изображение.
func keepBeforeTrailingBurst(n int, at func(int) int64) int {
	if n < 2 {
		return n
	}
	last := at(n - 1)
	i := n - 1
	for i > 0 && last-at(i-1) < 1000 && at(i)-at(i-1) < 5000 {
		i--
	}
	if i > 0 && at(i)-at(i-1) >= 5000 && last-at(i) < 1000 {
		return i
	}
	return n
}

// activeIntervals — отрезки, где дорожка шла без пауз длиннее activeGapMs.
func activeIntervals(n int, at func(int) int64, tailMs int64) []Interval {
	var out []Interval
	if n == 0 {
		return out
	}
	cur := Interval{StartMs: at(0), EndMs: at(0)}
	for k := 1; k < n; k++ {
		t := at(k)
		if t-cur.EndMs > activeGapMs {
			cur.EndMs += tailMs
			out = append(out, cur)
			cur = Interval{StartMs: t, EndMs: t}
			continue
		}
		cur.EndMs = t
	}
	cur.EndMs += tailMs
	return append(out, cur)
}

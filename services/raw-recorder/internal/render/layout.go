package render

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"matis/raw-recorder/internal/convert"
)

// Раскладка кадра — как шаблон записи Egress (`/egress`, EgressPage.tsx):
//   - демонстрация экрана → крупно слева + лента камер справа (190 px при 1280);
//   - иначе задание или доска → то же, в главной области кадр страницы
//     `/recording-replay`;
//   - иначе («люди») → адаптивная сетка камер на весь кадр.
// Порядок плиток — как RoomVideoGrid: персонал первым, дальше по времени входа.

// Rect — прямоугольник в пикселях кадра.
type Rect struct{ X, Y, W, H int }

// MainKind — что в главной области.
type MainKind string

const (
	MainNone     MainKind = "none"
	MainScreen   MainKind = "screen"
	MainBoard    MainKind = "board"
	MainActivity MainKind = "activity"
)

// Tile — плитка участника в сегменте.
type Tile struct {
	Identity string
	Name     string
	Rect     Rect
	// Video — ключ видеодорожки камеры, если в этом сегменте она шла; иначе заглушка с именем.
	Video string
}

// Segment — отрезок записи с неизменной раскладкой.
type Segment struct {
	StartMs int64
	EndMs   int64
	Main    MainKind
	// Screen — ключ дорожки демонстрации (Main == screen).
	Screen string
	Tiles  []Tile
	// Hidden — участники, не поместившиеся в ленту/сетку («+N»).
	Hidden int
}

// Geometry — размеры, общие для всех сегментов.
type Geometry struct {
	W, H    int
	Pad     int
	Gap     int
	RailW   int
	Main    Rect
	TileGap int
}

func NewGeometry(w, h int) Geometry {
	scale := float64(w) / 1280
	g := Geometry{W: w, H: h, Pad: px(12, scale), Gap: px(12, scale), RailW: px(190, scale), TileGap: px(8, scale)}
	g.Main = Rect{X: g.Pad, Y: g.Pad, W: w - 2*g.Pad - g.Gap - g.RailW, H: h - 2*g.Pad}
	g.Main.W -= g.Main.W % 2
	g.Main.H -= g.Main.H % 2
	return g
}

func px(v int, scale float64) int { return int(math.Round(float64(v) * scale)) }

// railVisible — плиток в ленте, как RAIL_VISIBLE в RoomVideoGrid.
const railVisible = 5

func (g Geometry) railTiles(n int) []Rect {
	tileW := g.RailW
	tileH := even(tileW * 9 / 16)
	x := g.W - g.Pad - g.RailW
	var out []Rect
	for i := 0; i < n; i++ {
		y := g.Pad + i*(tileH+g.TileGap)
		if y+tileH > g.H-g.Pad {
			break
		}
		out = append(out, Rect{X: x, Y: y, W: tileW, H: even(tileH)})
	}
	return out
}

// gridTiles — сетка 16:9 с максимальной плиткой (fitGrid из grid-layout.ts).
func (g Geometry) gridTiles(n int) []Rect {
	if n == 0 {
		return nil
	}
	gap := px(10, float64(g.W)/1280)
	aw, ah := g.W-2*g.Pad, g.H-2*g.Pad
	minTileW := float64(px(200, float64(g.W)/1280))
	count := n
	for count > 1 {
		if fit(count, aw, ah, gap).tileW >= minTileW {
			break
		}
		count--
	}
	f := fit(count, aw, ah, gap)
	gridW := float64(f.cols)*f.tileW + float64(gap*(f.cols-1))
	gridH := float64(f.rows)*f.tileH + float64(gap*(f.rows-1))
	ox := float64(g.Pad) + (float64(aw)-gridW)/2
	oy := float64(g.Pad) + (float64(ah)-gridH)/2
	out := make([]Rect, 0, count)
	for i := 0; i < count; i++ {
		x := ox + float64(i%f.cols)*(f.tileW+float64(gap))
		y := oy + float64(i/f.cols)*(f.tileH+float64(gap))
		out = append(out, Rect{X: even(int(x)), Y: even(int(y)), W: even(int(f.tileW)), H: even(int(f.tileH))})
	}
	return out
}

type fitResult struct {
	cols, rows   int
	tileW, tileH float64
}

func fit(count, w, h, gap int) fitResult {
	best := fitResult{cols: 1, rows: count}
	for cols := 1; cols <= count; cols++ {
		rows := (count + cols - 1) / cols
		tileW := math.Min(float64(w-gap*(cols-1))/float64(cols), float64(h-gap*(rows-1))/float64(rows)*16/9)
		if tileW > best.tileW {
			best = fitResult{cols: cols, rows: rows, tileW: tileW, tileH: tileW * 9 / 16}
		}
	}
	return best
}

func even(v int) int { return v - v%2 }

// ─── Состояние урока во времени ────────────────────────────────────────────

// Participant — участник по журналу (presence).
type Participant struct {
	Identity string
	Name     string
	Staff    bool
	JoinedAt string
}

// PresenceChange — состав подключённых участников с момента AtMs.
type PresenceChange struct {
	AtMs         int64
	Participants []Participant
}

// SceneChange — сцена урока (страница кадров `info().scenes`) с момента AtMs.
type SceneChange struct {
	AtMs int64
	Kind string // board | activity | people
}

// Inputs — всё, из чего строится раскладка.
type Inputs struct {
	DurationMs int64
	// MaxSegmentMs — длинные сегменты режутся на куски не длиннее этого (0 —
	// не резать): иначе час демонстрации — один ffmpeg на одном ядре, и
	// параллелизм сборки не помогает.
	MaxSegmentMs int64
	Presence     []PresenceChange
	Scenes       []SceneChange
	Tracks       []convert.Track
}

func isCamera(t convert.Track) bool {
	return t.Kind == "video" && t.Supported && t.Frames > 0 && strings.EqualFold(t.Source, "CAMERA")
}

func isScreen(t convert.Track) bool {
	return t.Kind == "video" && t.Supported && t.Frames > 0 && strings.EqualFold(t.Source, "SCREEN_SHARE")
}

func activeAt(t convert.Track, ms int64) bool {
	for _, iv := range t.Active {
		if ms >= iv.StartMs && ms < iv.EndMs {
			return true
		}
	}
	return false
}

// BuildSegments — разбивка шкалы на отрезки с неизменной раскладкой.
// Границы — любое изменение: состав, сцена, включение/выключение камер и
// демонстрации. Внутри отрезка раскладка постоянна.
func BuildSegments(in Inputs, g Geometry) []Segment {
	cuts := map[int64]bool{0: true, in.DurationMs: true}
	add := func(ms int64) {
		if ms > 0 && ms < in.DurationMs {
			cuts[ms] = true
		}
	}
	for _, p := range in.Presence {
		add(p.AtMs)
	}
	for _, s := range in.Scenes {
		add(s.AtMs)
	}
	for _, t := range in.Tracks {
		if isCamera(t) || isScreen(t) {
			for _, iv := range t.Active {
				add(iv.StartMs)
				add(iv.EndMs)
			}
			// Смена пропорций кадра — граница сегмента: внутри сегмента размер
			// после масштабирования постоянный (иначе crop/pad ffmpeg падают).
			for _, at := range t.AspectChanges {
				add(at)
			}
		}
	}
	times := make([]int64, 0, len(cuts))
	for t := range cuts {
		times = append(times, t)
	}
	sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })

	var segs []Segment
	for i := 0; i+1 < len(times); i++ {
		start, end := times[i], times[i+1]
		seg := layoutAt(in, g, start)
		seg.StartMs, seg.EndMs = start, end
		if n := len(segs); n > 0 && sameLayout(segs[n-1], seg) {
			segs[n-1].EndMs = end
			continue
		}
		segs = append(segs, seg)
	}
	return splitLong(mergeShort(segs, 200), in.MaxSegmentMs)
}

// splitLong — куски одинаковой раскладки не длиннее maxMs.
func splitLong(segs []Segment, maxMs int64) []Segment {
	if maxMs <= 0 {
		return segs
	}
	var out []Segment
	for _, s := range segs {
		n := (s.EndMs - s.StartMs + maxMs - 1) / maxMs
		if n <= 1 {
			out = append(out, s)
			continue
		}
		step := (s.EndMs - s.StartMs) / n
		for k := int64(0); k < n; k++ {
			part := s
			part.StartMs = s.StartMs + k*step
			if k < n-1 {
				part.EndMs = s.StartMs + (k+1)*step
			}
			out = append(out, part)
		}
	}
	return out
}

func layoutAt(in Inputs, g Geometry, ms int64) Segment {
	var people []Participant
	for _, p := range in.Presence {
		if p.AtMs <= ms {
			people = p.Participants
		}
	}
	scene := "people"
	for _, s := range in.Scenes {
		if s.AtMs <= ms {
			scene = s.Kind
		}
	}
	seg := Segment{Main: MainNone}
	// Демонстрация — в приоритете (как в EgressPage): последняя начатая из идущих.
	var screenStart int64 = -1
	for _, t := range in.Tracks {
		if isScreen(t) && activeAt(t, ms) && t.StartMs >= screenStart {
			seg.Screen, screenStart = t.Key, t.StartMs
		}
	}
	switch {
	case seg.Screen != "":
		seg.Main = MainScreen
	case scene == "activity":
		seg.Main = MainActivity
	case scene == "board":
		seg.Main = MainBoard
	}
	ordered := append([]Participant(nil), people...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].Staff != ordered[j].Staff {
			return ordered[i].Staff
		}
		return ordered[i].JoinedAt < ordered[j].JoinedAt
	})
	var rects []Rect
	if seg.Main == MainNone {
		rects = g.gridTiles(len(ordered))
	} else {
		n := len(ordered)
		if n > railVisible {
			n = railVisible
		}
		rects = g.railTiles(n)
	}
	for i, p := range ordered {
		if i >= len(rects) {
			seg.Hidden = len(ordered) - i
			break
		}
		tile := Tile{Identity: p.Identity, Name: p.Name, Rect: rects[i]}
		// Камера участника, идущая сейчас (после переподключения — новая дорожка).
		var camStart int64 = -1
		for _, t := range in.Tracks {
			if isCamera(t) && t.Identity == p.Identity && activeAt(t, ms) && t.StartMs >= camStart {
				tile.Video, camStart = t.Key, t.StartMs
			}
		}
		seg.Tiles = append(seg.Tiles, tile)
	}
	return seg
}

func sameLayout(a, b Segment) bool {
	if a.Main != b.Main || a.Screen != b.Screen || a.Hidden != b.Hidden || len(a.Tiles) != len(b.Tiles) {
		return false
	}
	for i := range a.Tiles {
		if a.Tiles[i] != b.Tiles[i] {
			return false
		}
	}
	return true
}

// mergeShort — отрезки короче minMs (десятки мс между почти одновременными
// событиями) приклеиваются к предыдущему: лишний запуск ffmpeg ради
// незаметной глазу разницы не нужен.
func mergeShort(segs []Segment, minMs int64) []Segment {
	var out []Segment
	for _, s := range segs {
		if n := len(out); n > 0 && s.EndMs-s.StartMs < minMs {
			out[n-1].EndMs = s.EndMs
			continue
		}
		out = append(out, s)
	}
	if len(out) > 1 && out[0].EndMs-out[0].StartMs < minMs {
		out[1].StartMs = out[0].StartMs
		out = out[1:]
	}
	return out
}

func (s Segment) String() string {
	return fmt.Sprintf("[%d..%d) main=%s screen=%s tiles=%d hidden=%d", s.StartMs, s.EndMs, s.Main, s.Screen, len(s.Tiles), s.Hidden)
}

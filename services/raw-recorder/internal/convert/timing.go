// Package convert — после урока: исходные RTP-дорожки → IVF (VP8) и Ogg
// (Opus) с метками времени на общей шкале записи.
//
// Общая шкала — часы хоста (Unix нс): рекордер помечает каждый пакет
// моментом прихода, журнал урока — моментом, когда событие увидел сервер.
// Время RTP у каждой дорожки своё (случайное начало, часы отправителя),
// поэтому для каждой дорожки строится отображение «время RTP → время хоста»:
//
//	t_host ≈ t_media + offset(t_media),
//
// где offset — нижняя огибающая (arrival − t_media): минимум по окнам 5 с
// отсекает сетевую задержку и джиттер, а линейная подгонка по минимумам
// учитывает дрейф часов отправителя (звуковая карта может уходить на
// 100+ ppm, т. е. ~0,4 с в час). Пакеты одного участника (звук и видео)
// приходят с одинаковой минимальной задержкой, так что губы и звук остаются
// синхронны в пределах единиц мс; сдвиг всей дорожки относительно журнала —
// минимальная задержка «отправитель → сервер» (десятки мс).
//
// RTCP Sender Report рекордер тоже сохраняет, но не использует: LiveKit
// пересчитывает SR на своей стороне, и проверять их согласованность между
// участниками — отдельная работа (docs/experimental-recording.md).
package convert

import (
	"math"
	"sort"
)

// point — пакет на шкалах: расширенное время RTP (без переполнения) и приход.
type point struct {
	ext       int64
	arrivalNs int64
	// id — номер пакета дорожки: время хоста считается для каждого пакета по
	// его собственному участку (участки могут пересекаться по времени RTP).
	id int
}

type timingRun struct {
	ext0, extEnd int64
	clock        float64
	// offset(m) = a + b·m, нс; m — время от начала прогона, нс.
	a, b float64
}

// Mapper — отображение времени RTP дорожки в часы хоста.
type Mapper struct {
	runs []timingRun
	byID map[int]int64
}

const (
	windowNs        = 5e9
	discontinuityNs = 2e9
	minFitWindows   = 4
)

// unwrap — 32-битное время RTP в непрерывное 64-битное (в порядке прихода).
type unwrapper struct {
	have bool
	last uint32
	ext  int64
}

func (u *unwrapper) next(ts uint32) int64 {
	if !u.have {
		u.have, u.last, u.ext = true, ts, int64(ts)
		return u.ext
	}
	u.ext += int64(int32(ts - u.last))
	u.last = ts
	return u.ext
}

// BuildMapper строит отображение по точкам в порядке прихода.
func BuildMapper(points []point, clockRate uint32) *Mapper {
	clock := float64(clockRate)
	m := &Mapper{byID: map[int]int64{}}
	if len(points) == 0 || clockRate == 0 {
		return m
	}
	start := 0
	for i := 1; i <= len(points); i++ {
		split := i == len(points)
		if !split {
			dA := float64(points[i].arrivalNs - points[i-1].arrivalNs)
			dM := float64(points[i].ext-points[i-1].ext) * 1e9 / clock
			split = math.Abs(dA-dM) > discontinuityNs
		}
		if split {
			for _, part := range splitLevelShifts(points[start:i], clock) {
				run := fitRun(part, clock)
				m.runs = append(m.runs, run)
				for _, p := range part {
					m.byID[p.id] = run.host(p.ext)
				}
			}
			start = i
		}
	}
	sort.Slice(m.runs, func(i, j int) bool { return m.runs[i].ext0 < m.runs[j].ext0 })
	return m
}

const (
	shiftWindowNs = 1e9
	// Ступенька смещения больше этого — сдвиг часов RTP отправителя (возврат
	// из DTX, перезапуск захвата), а не джиттер сети: минимум по окну 1 с
	// джиттер почти не видит.
	shiftThresholdNs = 50e6
	// Ступенька должна держаться столько окон подряд — одиночный выброс не в счёт.
	shiftConfirmWindows = 3
)

// splitLevelShifts делит участок на части с постоянным уровнем нижней
// огибающей (arrival − время RTP). Скачки времени RTP меньше
// discontinuityNs (например, +380 мс у отправителя при выходе из DTX) иначе
// усреднялись бы в одну прямую, и звук уезжал бы на сотни мс — найдено на
// тестовом уроке 2026-10-12.
func splitLevelShifts(pts []point, clock float64) [][]point {
	if len(pts) < 2 {
		return [][]point{pts}
	}
	sorted := append([]point(nil), pts...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ext < sorted[j].ext })
	ext0 := sorted[0].ext
	offs := make([]float64, len(sorted))
	widx := make([]int64, len(sorted))
	for i, p := range sorted {
		mNs := float64(p.ext-ext0) * 1e9 / clock
		offs[i] = float64(p.arrivalNs) - mNs
		widx[i] = int64(mNs / shiftWindowNs)
	}
	type win struct {
		idx int64
		min float64
	}
	var wins []win
	for i := range sorted {
		if n := len(wins); n > 0 && wins[n-1].idx == widx[i] {
			wins[n-1].min = math.Min(wins[n-1].min, offs[i])
			continue
		}
		wins = append(wins, win{widx[i], offs[i]})
	}
	// Точки разреза — позиции в sorted, с которых начинается новый уровень.
	var cuts []int
	segStart := 0
	cursor := 0
	for k := 1; k < len(wins); k++ {
		lo := k - 5
		if lo < segStart {
			lo = segStart
		}
		ref := median(wins[lo:k], func(w win) float64 { return w.min })
		if math.Abs(wins[k].min-ref) <= shiftThresholdNs {
			continue
		}
		confirmed := true
		for j := k + 1; j < k+shiftConfirmWindows && j < len(wins); j++ {
			if math.Abs(wins[j].min-wins[k].min) > shiftThresholdNs {
				confirmed = false
				break
			}
		}
		if !confirmed {
			continue
		}
		// Граница с точностью до пакета: в окнах k−1..k первый пакет, чьё
		// смещение по ту же сторону от середины уровней, что новый уровень.
		mid := (ref + wins[k].min) / 2
		down := wins[k].min < ref
		cut := -1
		for i := cursor; i < len(sorted); i++ {
			if widx[i] < wins[k-1].idx {
				continue
			}
			if widx[i] > wins[k].idx {
				break
			}
			if (down && offs[i] < mid) || (!down && offs[i] > mid) {
				cut = i
				break
			}
		}
		if cut <= cursor {
			continue
		}
		cuts = append(cuts, cut)
		cursor = cut
		segStart = k
	}
	if len(cuts) == 0 {
		return [][]point{pts}
	}
	var parts [][]point
	prev := 0
	for _, c := range append(cuts, len(sorted)) {
		parts = append(parts, sorted[prev:c])
		prev = c
	}
	return parts
}

func median[T any](items []T, val func(T) float64) float64 {
	vals := make([]float64, len(items))
	for i, it := range items {
		vals[i] = val(it)
	}
	sort.Float64s(vals)
	return vals[len(vals)/2]
}

func fitRun(pts []point, clock float64) timingRun {
	ext0, extEnd := pts[0].ext, pts[0].ext
	for _, p := range pts {
		if p.ext < ext0 {
			ext0 = p.ext
		}
		if p.ext > extEnd {
			extEnd = p.ext
		}
	}
	type win struct{ m, off float64 }
	windows := map[int64]win{}
	for _, p := range pts {
		mNs := float64(p.ext-ext0) * 1e9 / clock
		off := float64(p.arrivalNs) - mNs
		idx := int64(mNs / windowNs)
		if w, ok := windows[idx]; !ok || off < w.off {
			windows[idx] = win{m: mNs, off: off}
		}
	}
	ws := make([]win, 0, len(windows))
	for _, w := range windows {
		ws = append(ws, w)
	}
	run := timingRun{ext0: ext0, extEnd: extEnd, clock: clock}
	minOff := math.Inf(1)
	for _, w := range ws {
		minOff = math.Min(minOff, w.off)
	}
	run.a = minOff
	if len(ws) < minFitWindows {
		return run
	}
	// Линейная подгонка по минимумам окон, два прохода: окна, лежащие заметно
	// выше прямой (вся пачка пакетов задержалась), во втором проходе не учитываются.
	a, b := lsq(ws, func(w win) (float64, float64) { return w.m, w.off })
	for pass := 0; pass < 2; pass++ {
		var kept []win
		for _, w := range ws {
			if w.off-(a+b*w.m) < 20e6 {
				kept = append(kept, w)
			}
		}
		if len(kept) < minFitWindows {
			break
		}
		a, b = lsq(kept, func(w win) (float64, float64) { return w.m, w.off })
	}
	// Дрейф больше 1000 ppm — не часы, а ошибка подгонки: берём константу.
	if math.Abs(b) > 1e-3 {
		return run
	}
	run.a, run.b = a, b
	return run
}

func lsq[T any](items []T, xy func(T) (float64, float64)) (float64, float64) {
	var sx, sy, sxx, sxy, n float64
	for _, it := range items {
		x, y := xy(it)
		sx += x
		sy += y
		sxx += x * x
		sxy += x * y
		n++
	}
	den := n*sxx - sx*sx
	if den == 0 {
		return sy / n, 0
	}
	b := (n*sxy - sx*sy) / den
	return (sy - b*sx) / n, b
}

func (r timingRun) host(ext int64) int64 {
	mNs := float64(ext-r.ext0) * 1e9 / r.clock
	return int64(mNs + r.a + r.b*mNs)
}

// HostNsFor — момент на часах хоста для пакета (по его участку).
func (m *Mapper) HostNsFor(p point) int64 {
	if v, ok := m.byID[p.id]; ok {
		return v
	}
	return m.HostNs(p.ext)
}

// HostNs — момент на часах хоста для расширенного времени RTP (участок — по времени RTP).
func (m *Mapper) HostNs(ext int64) int64 {
	if len(m.runs) == 0 {
		return 0
	}
	run := m.runs[0]
	for _, r := range m.runs {
		if ext >= r.ext0 {
			run = r
		}
	}
	mNs := float64(ext-run.ext0) * 1e9 / run.clock
	return int64(mNs + run.a + run.b*mNs)
}

// Runs — число непрерывных участков (для метрик/диагностики).
func (m *Mapper) Runs() int { return len(m.runs) }

// DriftPPM — дрейф часов отправителя относительно часов хоста (самый длинный участок).
func (m *Mapper) DriftPPM() float64 {
	best, span := 0.0, int64(-1)
	for _, r := range m.runs {
		if r.extEnd-r.ext0 > span {
			best, span = r.b*1e6, r.extEnd-r.ext0
		}
	}
	return best
}

// LagStats — насколько позже восстановленного времени приходили пакеты:
// p50/p99/max (мс). Отрицательных значений быть не должно (меньше −2 мс —
// ошибка подгонки); p99 — оценка джиттера сети до сервера.
func LagStats(m *Mapper, pts []point) (p50, p99, maxLag, minLag float64) {
	if len(pts) == 0 {
		return
	}
	lags := make([]float64, len(pts))
	for i, p := range pts {
		lags[i] = float64(p.arrivalNs-m.HostNsFor(p)) / 1e6
	}
	sort.Float64s(lags)
	return lags[len(lags)/2], lags[len(lags)*99/100], lags[len(lags)-1], lags[0]
}

package convert

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/pion/rtp"

	"matis/raw-recorder/internal/dump"
)

// Отображение времени: случайное начало RTP, джиттер прихода, дрейф часов
// отправителя 200 ppm — результат должен совпасть с истинным моментом
// отправки + минимальная задержка в пределах нескольких мс.
func TestMapperRecoversHostTimeWithJitterAndDrift(t *testing.T) {
	const clock = 48000
	const drift = 200e-6
	sendStart := int64(1_790_000_000_000_000_000)
	rtp0 := int64(3_000_000_000) // близко к переполнению uint32 — проверка unwrap
	var pts []point
	var u unwrapper
	for i := 0; i < 50*60*20; i++ { // 20 минут пакетов по 20 мс
		trueNs := int64(i) * 20e6
		ts := uint32(rtp0 + int64(float64(trueNs)*(1+drift)*clock/1e9))
		jitter := int64((i*7919)%40) * 1e6 // 0..39 мс
		arrival := sendStart + trueNs + 15e6 + jitter
		pts = append(pts, point{ext: u.next(ts), arrivalNs: arrival, id: len(pts)})
	}
	m := BuildMapper(pts, clock)
	if m.Runs() != 1 {
		t.Fatalf("runs = %d", m.Runs())
	}
	for _, i := range []int{0, 30000, 59999} {
		got := m.HostNs(pts[i].ext)
		want := sendStart + int64(i)*20e6 + 15e6
		if d := math.Abs(float64(got-want)) / 1e6; d > 5 {
			t.Errorf("packet %d: off by %.1f ms", i, d)
		}
	}
}

func TestMapperSplitsOnTimestampJump(t *testing.T) {
	var pts []point
	var u unwrapper
	base := int64(1e18)
	for i := 0; i < 500; i++ {
		pts = append(pts, point{ext: u.next(uint32(i * 960)), arrivalNs: base + int64(i)*20e6})
	}
	// отправитель перезапустил кодер: RTP прыгнул вперёд на час, время прихода — нет
	for i := 0; i < 500; i++ {
		pts = append(pts, point{ext: u.next(uint32(500*960 + 3600*48000 + i*960)), arrivalNs: base + int64(500+i)*20e6})
	}
	m := BuildMapper(pts, 48000)
	if m.Runs() != 2 {
		t.Fatalf("runs = %d, want 2", m.Runs())
	}
	got := m.HostNs(pts[700].ext)
	want := base + 700*20e6
	if d := math.Abs(float64(got-want)) / 1e6; d > 1 {
		t.Errorf("after jump off by %.1f ms", d)
	}
}

func TestOpusSamples(t *testing.T) {
	cases := map[byte]int{
		0xfc: 960,  // CELT 20 мс, 1 кадр, стерео (config 31)
		0x78: 960,  // hybrid FB 20 мс (config 15)
		0x08: 960,  // SILK NB 20 мс (config 1)
		0xf8: 960,  // CELT FB 20 мс mono
		0xfd: 1920, // 2 кадра по 20 мс
	}
	for toc, want := range cases {
		if got := opusSamples([]byte{toc, 0, 0}); got != want {
			t.Errorf("toc %#x: %d, want %d", toc, got, want)
		}
	}
}

// writeTrack — дорожка в формате рекордера из готовых RTP-пакетов.
func writeTrack(t *testing.T, dir string, meta dump.TrackMeta, pkts []rtp.Packet, arrivals []int64) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := dump.WriteMeta(dir, meta); err != nil {
		t.Fatal(err)
	}
	w, err := dump.Create(filepath.Join(dir, dump.ChunkName(1)))
	if err != nil {
		t.Fatal(err)
	}
	for i, p := range pkts {
		data, _ := p.Marshal()
		if err := w.Write(dump.Record{Type: dump.RecordRTP, ArrivalNs: arrivals[i], Data: data}); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
}

// vp8Frame — два пакета на кадр: дескриптор VP8 (S/PID) + полезная нагрузка.
func vp8Frame(seq uint16, ts uint32, key bool) []rtp.Packet {
	first := []byte{0x10} // S=1, PID=0
	if key {
		// заголовок ключевого кадра: P=0, стартовый код, 320x240
		first = append(first, 0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xf0, 0x00)
	} else {
		first = append(first, 0x01, 0x00, 0x00)
	}
	return []rtp.Packet{
		{Header: rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: ts, SSRC: 1}, Payload: first},
		{Header: rtp.Header{Version: 2, SequenceNumber: seq + 1, Timestamp: ts, SSRC: 1, Marker: true}, Payload: []byte{0x00, 0xaa, 0xbb}},
	}
}

func TestConvertVP8DropsUntilKeyframeAfterLoss(t *testing.T) {
	root := t.TempDir()
	trackDir := filepath.Join(root, "rec", "attempt-1", "001_u_camera_TR1")
	t0Ms := int64(1_790_000_000_000)
	var pkts []rtp.Packet
	var arr []int64
	seq := uint16(65530) // переполнение номеров в середине
	for f := 0; f < 30; f++ {
		key := f == 0 || f == 20
		fr := vp8Frame(seq, uint32(f*3000), key)
		seq += 2
		if f == 10 {
			fr = fr[:1] // потерян конец кадра 10 → кадры 10..19 не декодируемы
		}
		for range fr {
			arr = append(arr, (t0Ms+1000)*1e6+int64(f)*33_333_333)
		}
		pkts = append(pkts, fr...)
	}
	writeTrack(t, trackDir, dump.TrackMeta{Key: "001_u_camera_TR1", Attempt: 1, Identity: "u", Source: "CAMERA", Kind: "video", MimeType: "video/VP8", ClockRate: 90000}, pkts, arr)

	idx, err := ConvertRecording(filepath.Join(root, "rec"), filepath.Join(root, "out"), t0Ms)
	if err != nil {
		t.Fatal(err)
	}
	if len(idx.Tracks) != 1 {
		t.Fatalf("tracks = %d", len(idx.Tracks))
	}
	tr := idx.Tracks[0]
	if tr.Frames != 20 || tr.Dropped != 10 {
		t.Fatalf("frames=%d dropped=%d, want 20/10", tr.Frames, tr.Dropped)
	}
	if tr.Width != 320 || tr.Height != 240 {
		t.Errorf("size %dx%d", tr.Width, tr.Height)
	}
	if len(tr.Keyframes) != 2 {
		t.Fatalf("keyframes = %d", len(tr.Keyframes))
	}
	if tr.StartMs < 990 || tr.StartMs > 1010 {
		t.Errorf("startMs = %d, want ≈1000", tr.StartMs)
	}
	// IVF: заголовок, число кадров, метка второго ключевого кадра.
	data, err := os.ReadFile(filepath.Join(root, "out", tr.File))
	if err != nil {
		t.Fatal(err)
	}
	if string(data[0:4]) != "DKIF" || binary.LittleEndian.Uint32(data[24:28]) != 20 {
		t.Fatalf("bad ivf header")
	}
	kf := tr.Keyframes[1]
	pts := int64(binary.LittleEndian.Uint64(data[kf.Offset+4 : kf.Offset+12]))
	if pts != kf.PtsMs || pts < 1666-5 || pts > 1666+5 {
		t.Errorf("second keyframe pts %d", pts)
	}
	// Повторный вызов — из контрольной точки.
	again, err := ConvertRecording(filepath.Join(root, "rec"), filepath.Join(root, "out"), t0Ms)
	if err != nil || again.Tracks[0].Frames != 20 {
		t.Fatalf("checkpoint: %v", err)
	}
}

func TestConvertOpusGranulesFollowHostTime(t *testing.T) {
	root := t.TempDir()
	trackDir := filepath.Join(root, "rec", "attempt-1", "002_u_microphone_TR2")
	t0Ms := int64(1_790_000_000_000)
	var pkts []rtp.Packet
	var arr []int64
	for i := 0; i < 600; i++ {
		if i >= 200 && i < 300 {
			continue // 2 с тишины (DTX/выключенный микрофон)
		}
		pkts = append(pkts, rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: uint16(i), Timestamp: uint32(i * 960), SSRC: 2}, Payload: []byte{0xfc, 0x01, 0x02}})
		arr = append(arr, (t0Ms+5000)*1e6+int64(i)*20e6)
	}
	writeTrack(t, trackDir, dump.TrackMeta{Key: "002_u_microphone_TR2", Attempt: 1, Identity: "u", Source: "MICROPHONE", Kind: "audio", MimeType: "audio/opus", ClockRate: 48000, Channels: 2}, pkts, arr)
	idx, err := ConvertRecording(filepath.Join(root, "rec"), filepath.Join(root, "out"), t0Ms)
	if err != nil {
		t.Fatal(err)
	}
	tr := idx.Tracks[0]
	if tr.Frames != 500 {
		t.Fatalf("packets = %d", tr.Frames)
	}
	if tr.StartMs < 4995 || tr.StartMs > 5005 {
		t.Errorf("startMs = %d, want ≈5000", tr.StartMs)
	}
	if len(tr.Active) != 2 {
		t.Errorf("active intervals = %v, want 2 (пауза 2 с)", tr.Active)
	}
	// Гранула первой страницы с данными ≈ (5 с + 20 мс) × 48000.
	data, _ := os.ReadFile(filepath.Join(root, "out", tr.File))
	granules := oggGranules(t, data)
	if len(granules) < 3 {
		t.Fatalf("pages = %d", len(granules))
	}
	first := granules[2]
	if first < 5000*48+960-480 || first > 5000*48+960+480 {
		t.Errorf("first data granule %d", first)
	}
	for i := 3; i < len(granules); i++ {
		if granules[i] < granules[i-1] {
			t.Fatalf("granule decreased at page %d", i)
		}
	}
}

func oggGranules(t *testing.T, data []byte) []int64 {
	var out []int64
	for pos := 0; pos+27 <= len(data); {
		if string(data[pos:pos+4]) != "OggS" {
			t.Fatalf("bad page at %d", pos)
		}
		page := data[pos:]
		segs := int(page[26])
		size := 0
		for i := 0; i < segs; i++ {
			size += int(page[27+i])
		}
		total := 27 + segs + size
		crc := binary.LittleEndian.Uint32(page[22:26])
		check := append([]byte(nil), page[:total]...)
		binary.LittleEndian.PutUint32(check[22:26], 0)
		if oggCRC(check) != crc {
			t.Fatalf("crc mismatch at page %d", len(out))
		}
		out = append(out, int64(binary.LittleEndian.Uint64(page[6:14])))
		pos += total
	}
	return out
}

func TestTruncatedChunkIsReadUpToLastWholeRecord(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, dump.ChunkName(1))
	w, err := dump.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		_ = w.Write(dump.Record{Type: dump.RecordRTP, ArrivalNs: int64(i), Data: []byte{1, 2, 3, 4}})
	}
	_ = w.Close()
	data, _ := os.ReadFile(path)
	_ = os.WriteFile(path, data[:len(data)-2], 0o644) // процесс упал посреди записи
	recs, err := dump.ReadChunk(path)
	if err != dump.ErrTruncated || len(recs) != 2 {
		t.Fatalf("recs=%d err=%v", len(recs), err)
	}
}

// Как генератор нагрузки (и, возможно, клиенты): DTX-пакет раз в 400 мс, а при
// возврате к речи время RTP прыгает вперёд на 380 мс. Скачки копятся; без
// разбиения по ступенькам звук уезжал на секунды (тестовый урок 2026-10-12).
func TestMapperFollowsDTXTimestampSteps(t *testing.T) {
	const clock = 48000
	base := int64(1_790_000_000_000_000_000)
	var pts []point
	var u unwrapper
	rtpNs := int64(0)
	wall := int64(0)
	var trueWall []int64
	for cycle := 0; cycle < 12; cycle++ {
		for i := 0; i < 300; i++ { // 6 с речи
			jitter := int64((i*31)%7) * 1e6
			pts = append(pts, point{ext: u.next(uint32(rtpNs * clock / 1e9)), arrivalNs: base + wall + 10e6 + jitter, id: len(pts)})
			trueWall = append(trueWall, base+wall+10e6)
			rtpNs += 20e6
			wall += 20e6
		}
		for i := 0; i < 35; i++ { // 14 с DTX
			pts = append(pts, point{ext: u.next(uint32(rtpNs * clock / 1e9)), arrivalNs: base + wall + 10e6, id: len(pts)})
			trueWall = append(trueWall, base+wall+10e6)
			rtpNs += 400e6
			wall += 400e6
		}
		rtpNs += 380e6 // скачок при возврате к речи
	}
	m := BuildMapper(pts, clock)
	worst := 0.0
	for i, p := range pts {
		d := math.Abs(float64(m.HostNsFor(p)-trueWall[i])) / 1e6
		if d > worst {
			worst = d
		}
	}
	if worst > 30 {
		t.Fatalf("worst mapping error %.1f ms (runs=%d)", worst, m.Runs())
	}
	p50, p99, _, minLag := LagStats(m, pts)
	if p50 > 5 || p99 > 15 || minLag < -2 {
		t.Errorf("lag p50=%.1f p99=%.1f min=%.1f", p50, p99, minLag)
	}
}

// Пакеты «пустых» кадров SFU после падения участника: метки RTP продолжают
// старые, приходят через 47 с. Настоящие пакеты не должны получить их время.
func TestMapperKeepsOverlappingRunsApart(t *testing.T) {
	const clock = 48000
	base := int64(1e18)
	var pts []point
	var u unwrapper
	for i := 0; i < 2500; i++ { // 50 с речи
		pts = append(pts, point{ext: u.next(uint32(i * 960)), arrivalNs: base + int64(i)*20e6, id: i})
	}
	// хвост: метки чуть РАНЬШЕ конца (SFU пересчитал), приход на 47 с позже
	for k := 0; k < 15; k++ {
		pts = append(pts, point{ext: u.next(uint32((2490 + k) * 960)), arrivalNs: base + 97e9 + int64(k)*20e6, id: 2500 + k})
	}
	m := BuildMapper(pts, clock)
	for _, i := range []int{0, 2489, 2499} {
		got := m.HostNsFor(pts[i])
		if d := math.Abs(float64(got-pts[i].arrivalNs)) / 1e6; d > 5 {
			t.Errorf("real packet %d off by %.1f ms", i, d)
		}
	}
	if keep := keepBeforeTrailingBurst(len(pts), func(k int) int64 { return pts[k].arrivalNs / 1e6 }); keep != 2500 {
		t.Errorf("keep = %d, want 2500 (хвост SFU отброшен)", keep)
	}
}

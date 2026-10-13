package convert

import (
	"bufio"
	"encoding/binary"
	"errors"
	"os"
)

// ─── IVF (VP8 или H.264) с явными метками времени ────────────────────────────────────
// pion/ivfwriter ставит номер кадра вместо времени — видео шло бы с
// неверной скоростью (об этом прямо сказано в примере filesaver
// server-sdk-go). Здесь pts — мс от начала шкалы записи.

type ivfWriter struct {
	f      *os.File
	w      *bufio.Writer
	frames uint32
}

func createIVF(path, fourcc string, width, height uint16) (*ivfWriter, error) {
	f, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	var h [32]byte
	copy(h[0:4], "DKIF")
	binary.LittleEndian.PutUint16(h[4:6], 0)
	binary.LittleEndian.PutUint16(h[6:8], 32)
	copy(h[8:12], fourcc)
	binary.LittleEndian.PutUint16(h[12:14], width)
	binary.LittleEndian.PutUint16(h[14:16], height)
	binary.LittleEndian.PutUint32(h[16:20], 1000) // timebase: 1/1000 с
	binary.LittleEndian.PutUint32(h[20:24], 1)
	if _, err := w.Write(h[:]); err != nil {
		f.Close()
		return nil, err
	}
	return &ivfWriter{f: f, w: w}, nil
}

func (v *ivfWriter) writeFrame(ptsMs int64, data []byte) error {
	var h [12]byte
	binary.LittleEndian.PutUint32(h[0:4], uint32(len(data)))
	binary.LittleEndian.PutUint64(h[4:12], uint64(ptsMs))
	if _, err := v.w.Write(h[:]); err != nil {
		return err
	}
	_, err := v.w.Write(data)
	v.frames++
	return err
}

func (v *ivfWriter) close() error {
	if err := v.w.Flush(); err != nil {
		v.f.Close()
		return err
	}
	var n [4]byte
	binary.LittleEndian.PutUint32(n[:], v.frames)
	if _, err := v.f.WriteAt(n[:], 24); err != nil {
		v.f.Close()
		return err
	}
	if err := v.f.Sync(); err != nil {
		v.f.Close()
		return err
	}
	return v.f.Close()
}

// ─── Ogg Opus с явной гранулой ─────────────────────────────────────────────
// Один Opus-пакет на страницу; гранула (конец пакета в отсчётах 48 кГц от
// начала шкалы) задаёт время, пропуски (DTX, выключенный микрофон, обрыв)
// — скачком гранулы, который ffmpeg превращает в разрыв меток, а рендер
// заполняет тишиной (aresample async).

var oggCRCTable = func() [256]uint32 {
	var t [256]uint32
	for i := range t {
		r := uint32(i) << 24
		for j := 0; j < 8; j++ {
			if r&0x80000000 != 0 {
				r = (r << 1) ^ 0x04c11db7
			} else {
				r <<= 1
			}
		}
		t[i] = r
	}
	return t
}()

func oggCRC(data []byte) uint32 {
	var crc uint32
	for _, b := range data {
		crc = (crc << 8) ^ oggCRCTable[byte(crc>>24)^b]
	}
	return crc
}

type oggWriter struct {
	f       *os.File
	w       *bufio.Writer
	serial  uint32
	pageSeq uint32
	granule int64
	packets int
}

func createOggOpus(path string, channels uint8) (*oggWriter, error) {
	f, err := os.Create(path)
	if err != nil {
		return nil, err
	}
	o := &oggWriter{f: f, w: bufio.NewWriterSize(f, 1<<20), serial: 0x4d415449}
	head := make([]byte, 19)
	copy(head[0:8], "OpusHead")
	head[8] = 1
	head[9] = channels
	binary.LittleEndian.PutUint16(head[10:12], 0) // pre-skip 0: время пакетов не сдвигаем
	binary.LittleEndian.PutUint32(head[12:16], 48000)
	if err := o.page(head, 0, 0x02); err != nil {
		f.Close()
		return nil, err
	}
	vendor := "matis-raw-recorder"
	tags := make([]byte, 8+4+len(vendor)+4)
	copy(tags[0:8], "OpusTags")
	binary.LittleEndian.PutUint32(tags[8:12], uint32(len(vendor)))
	copy(tags[12:], vendor)
	if err := o.page(tags, 0, 0); err != nil {
		f.Close()
		return nil, err
	}
	return o, nil
}

func (o *oggWriter) page(packet []byte, granule int64, headerType byte) error {
	if len(packet) > 255*255 {
		return errors.New("ogg packet too large")
	}
	segs := len(packet)/255 + 1
	lacing := make([]byte, segs)
	for i := 0; i < segs-1; i++ {
		lacing[i] = 255
	}
	lacing[segs-1] = byte(len(packet) % 255)
	page := make([]byte, 27+segs+len(packet))
	copy(page[0:4], "OggS")
	page[5] = headerType
	binary.LittleEndian.PutUint64(page[6:14], uint64(granule))
	binary.LittleEndian.PutUint32(page[14:18], o.serial)
	binary.LittleEndian.PutUint32(page[18:22], o.pageSeq)
	page[26] = byte(segs)
	copy(page[27:], lacing)
	copy(page[27+segs:], packet)
	binary.LittleEndian.PutUint32(page[22:26], oggCRC(page))
	o.pageSeq++
	_, err := o.w.Write(page)
	return err
}

// writePacket — пакет, начинающийся в startSample (отсчёты 48 кГц от начала шкалы).
// Наложение на предыдущий пакет (погрешность отображения времени) — пакет
// ставится сразу за предыдущим; гранула только растёт.
func (o *oggWriter) writePacket(startSample int64, samples int, data []byte) error {
	if startSample < o.granule {
		startSample = o.granule
	}
	end := startSample + int64(samples)
	o.granule = end
	o.packets++
	return o.page(data, end, 0)
}

func (o *oggWriter) close() error {
	// Пустая последняя страница с флагом конца потока.
	if err := o.page(nil, o.granule, 0x04); err != nil {
		o.f.Close()
		return err
	}
	if err := o.w.Flush(); err != nil {
		o.f.Close()
		return err
	}
	if err := o.f.Sync(); err != nil {
		o.f.Close()
		return err
	}
	return o.f.Close()
}

// opusSamples — длительность Opus-пакета в отсчётах 48 кГц по TOC (RFC 6716 §3.1).
func opusSamples(packet []byte) int {
	if len(packet) == 0 {
		return 0
	}
	toc := packet[0]
	config := toc >> 3
	var frameSamples int // длительность одного кадра в отсчётах 48 кГц
	switch {
	case config < 12:
		frameSamples = []int{480, 960, 1920, 2880}[config%4]
	case config < 16:
		frameSamples = []int{480, 960}[config%2]
	default:
		frameSamples = []int{120, 240, 480, 960}[config%4]
	}
	frames := 1
	switch toc & 0x03 {
	case 0:
		frames = 1
	case 1, 2:
		frames = 2
	case 3:
		if len(packet) < 2 {
			return 0
		}
		frames = int(packet[1] & 0x3f)
	}
	return frames * frameSamples
}

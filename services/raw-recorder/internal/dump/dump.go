// Package dump — формат исходных дорожек экспериментальной записи.
//
// Рекордер не депакетизирует и не перекодирует медиа во время урока: каждый
// RTP-пакет дорожки пишется как есть вместе с моментом прихода (часы хоста,
// Unix нс). Файлы режутся на чанки по ~60 с: при падении процесса теряется
// только недописанный хвост последнего чанка (буфер сбрасывается раз в
// секунду), а читатель останавливается на обрезанной записи.
//
// Формат чанка: заголовок "MATISRTP1\n", затем записи
//
//	[1 байт тип][8 байт время прихода, нс, big-endian][2 байта длина][данные]
//
// Тип 1 — RTP-пакет (как пришёл, после SRTP), 2 — RTCP Sender Report
// (маршализованный), 3 — запрос ключевого кадра (PLI) от рекордера.
package dump

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const header = "MATISRTP1\n"

// Типы записей.
const (
	RecordRTP byte = 1
	RecordSR  byte = 2
	RecordPLI byte = 3
)

// Record — одна запись чанка.
type Record struct {
	Type      byte
	ArrivalNs int64
	Data      []byte
}

// TrackMeta — описание дорожки (track.json рядом с чанками).
type TrackMeta struct {
	Key            string `json:"key"`
	Attempt        int    `json:"attempt"`
	Identity       string `json:"identity"`
	Name           string `json:"name"`
	TrackSID       string `json:"trackSid"`
	Source         string `json:"source"`
	Kind           string `json:"kind"`
	MimeType       string `json:"mimeType"`
	ClockRate      uint32 `json:"clockRate"`
	Channels       uint16 `json:"channels"`
	PayloadType    uint8  `json:"payloadType"`
	SSRC           uint32 `json:"ssrc"`
	SubscribedAtNs int64  `json:"subscribedAtNs"`
	EndedAtNs      int64  `json:"endedAtNs,omitempty"`
	Packets        int64  `json:"packets"`
	Bytes          int64  `json:"bytes"`
	LostPackets    int64  `json:"lostPackets"`
	PLIs           int64  `json:"plis"`
	Chunks         int    `json:"chunks"`
}

// ChunkName — имя файла чанка по номеру.
func ChunkName(index int) string {
	return fmt.Sprintf("chunk-%06d.rtpd", index)
}

// Writer пишет записи в открытый чанк через буфер.
type Writer struct {
	f *os.File
	w *bufio.Writer
}

// Create создаёт файл чанка и пишет заголовок.
func Create(path string) (*Writer, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	w := bufio.NewWriterSize(f, 256*1024)
	if _, err := w.WriteString(header); err != nil {
		f.Close()
		return nil, err
	}
	return &Writer{f: f, w: w}, nil
}

// Write добавляет запись.
func (w *Writer) Write(rec Record) error {
	if len(rec.Data) > 0xffff {
		return fmt.Errorf("record too large: %d", len(rec.Data))
	}
	var hdr [11]byte
	hdr[0] = rec.Type
	binary.BigEndian.PutUint64(hdr[1:9], uint64(rec.ArrivalNs))
	binary.BigEndian.PutUint16(hdr[9:11], uint16(len(rec.Data)))
	if _, err := w.w.Write(hdr[:]); err != nil {
		return err
	}
	_, err := w.w.Write(rec.Data)
	return err
}

// Flush сбрасывает буфер в файл (без fsync).
func (w *Writer) Flush() error {
	return w.w.Flush()
}

// Close сбрасывает буфер, делает fsync и закрывает файл.
func (w *Writer) Close() error {
	if err := w.w.Flush(); err != nil {
		w.f.Close()
		return err
	}
	if err := w.f.Sync(); err != nil {
		w.f.Close()
		return err
	}
	return w.f.Close()
}

// ErrTruncated — последняя запись чанка обрезана (процесс упал при записи).
var ErrTruncated = errors.New("truncated record")

// ReadChunk читает все записи чанка. Обрезанная последняя запись не ошибка
// данных: возвращаются целые записи и `ErrTruncated`.
func ReadChunk(path string) ([]Record, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := bufio.NewReaderSize(f, 256*1024)
	h := make([]byte, len(header))
	if _, err := io.ReadFull(r, h); err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, ErrTruncated
		}
		return nil, err
	}
	if string(h) != header {
		return nil, fmt.Errorf("%s: not a rtp dump", path)
	}
	var out []Record
	var hdr [11]byte
	for {
		if _, err := io.ReadFull(r, hdr[:]); err != nil {
			if errors.Is(err, io.EOF) {
				return out, nil
			}
			return out, ErrTruncated
		}
		n := binary.BigEndian.Uint16(hdr[9:11])
		data := make([]byte, n)
		if _, err := io.ReadFull(r, data); err != nil {
			return out, ErrTruncated
		}
		out = append(out, Record{Type: hdr[0], ArrivalNs: int64(binary.BigEndian.Uint64(hdr[1:9])), Data: data})
	}
}

// WriteMeta атомарно пишет track.json (через временный файл и rename).
func WriteMeta(dir string, meta TrackMeta) error {
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return WriteFileAtomic(filepath.Join(dir, "track.json"), data)
}

// ReadMeta читает track.json.
func ReadMeta(dir string) (TrackMeta, error) {
	var meta TrackMeta
	data, err := os.ReadFile(filepath.Join(dir, "track.json"))
	if err != nil {
		return meta, err
	}
	err = json.Unmarshal(data, &meta)
	return meta, err
}

// WriteFileAtomic — запись файла целиком: временный файл, fsync, rename.
func WriteFileAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ListChunks — файлы чанков каталога дорожки по порядку.
func ListChunks(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "chunk-") && strings.HasSuffix(e.Name(), ".rtpd") {
			out = append(out, filepath.Join(dir, e.Name()))
		}
	}
	sort.Strings(out)
	return out, nil
}

// SafeName — часть имени файла из identity/sid: только [A-Za-z0-9_-].
func SafeName(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	if b.Len() > 80 {
		return b.String()[:80]
	}
	return b.String()
}

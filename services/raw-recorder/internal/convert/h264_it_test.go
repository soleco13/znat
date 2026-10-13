package convert

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pion/rtp"
	"github.com/pion/rtp/codecs"

	"matis/raw-recorder/internal/dump"
)

// H.264 от участника со слабым процессором (аппаратный кодер): RTP → IVF
// 'H264' → ffmpeg декодирует без ошибок, размер из SPS с обрезкой (640×360
// не кратно 16 по высоте), после потери — пропуск до IDR.
// Нужен ffmpeg с libx264 — запускать собранный `go test -c` в образе:
//
//	RAWREC_FFMPEG_IT=1 /tmp/convert.test -test.run H264
func TestConvertH264RoundTripThroughFFmpeg(t *testing.T) {
	if os.Getenv("RAWREC_FFMPEG_IT") == "" {
		t.Skip("RAWREC_FFMPEG_IT не задан")
	}
	dir := t.TempDir()
	raw := filepath.Join(dir, "in.h264")
	// 4 с по 15 кадр/с, IDR каждую секунду, AUD — граница кадра.
	cmd := exec.Command("ffmpeg", "-nostdin", "-y", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc=s=640x360:r=15:d=4",
		"-c:v", "libx264", "-profile:v", "baseline", "-pix_fmt", "yuv420p", "-g", "15",
		"-x264-params", "aud=1:repeat-headers=1", "-bsf:v", "h264_mp4toannexb", "-f", "h264", raw)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v %s", err, out)
	}
	stream, err := os.ReadFile(raw)
	if err != nil {
		t.Fatal(err)
	}
	// Кадры — по AUD (тип 9).
	var aus [][]byte
	for _, nal := range splitAnnexB(stream) {
		if len(nal) == 0 {
			continue
		}
		if nal[0]&0x1f == 9 || len(aus) == 0 {
			aus = append(aus, nil)
			if nal[0]&0x1f == 9 {
				continue
			}
		}
		aus[len(aus)-1] = append(aus[len(aus)-1], append([]byte{0, 0, 0, 1}, nal...)...)
	}
	if len(aus) != 60 {
		t.Fatalf("access units = %d", len(aus))
	}

	t0Ms := int64(1_790_000_000_000)
	pay := &codecs.H264Payloader{}
	var pkts []rtp.Packet
	var arr []int64
	seq := uint16(65500)
	for f, au := range aus {
		payloads := pay.Payload(1200, au)
		for k, p := range payloads {
			if f == 20 && k == len(payloads)-1 {
				seq++ // потерян конец кадра 20 → кадры 20..29 не декодируемы (IDR на 30)
				continue
			}
			pkts = append(pkts, rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(f * 6000), SSRC: 7, Marker: k == len(payloads)-1}, Payload: p})
			arr = append(arr, (t0Ms+500)*1e6+int64(f)*66_666_667)
			seq++
		}
	}
	trackDir := filepath.Join(dir, "rec", "attempt-1", "001_u_screen_TR1")
	writeTrack(t, trackDir, dump.TrackMeta{Key: "001_u_screen_TR1", Attempt: 1, Identity: "u", Source: "SCREEN_SHARE", Kind: "video", MimeType: "video/H264", ClockRate: 90000}, pkts, arr)

	idx, err := ConvertRecording(filepath.Join(dir, "rec"), filepath.Join(dir, "out"), t0Ms)
	if err != nil {
		t.Fatal(err)
	}
	tr := idx.Tracks[0]
	if !tr.Supported || tr.Width != 640 || tr.Height != 360 {
		t.Fatalf("supported=%v size %dx%d", tr.Supported, tr.Width, tr.Height)
	}
	// Кадр 20 — один пакет, он пропал целиком; 21..29 ждут IDR.
	if tr.Frames != 50 || tr.Dropped != 9 {
		t.Fatalf("frames=%d dropped=%d, want 50/9", tr.Frames, tr.Dropped)
	}
	if len(tr.Keyframes) != 4 {
		t.Fatalf("keyframes = %d", len(tr.Keyframes))
	}
	ivf := filepath.Join(dir, "out", tr.File)
	probe, err := exec.Command("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", ivf).CombinedOutput()
	if err != nil || strings.TrimSpace(string(probe)) != "h264,640,360" {
		t.Fatalf("ffprobe: %v %q", err, probe)
	}
	var stderr bytes.Buffer
	dec := exec.Command("ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", ivf, "-f", "null", "-")
	dec.Stderr = &stderr
	if err := dec.Run(); err != nil {
		t.Fatalf("decode: %v %s", err, stderr.String())
	}
}

func TestH264SPSSizeWithCropping(t *testing.T) {
	// SPS x264 baseline 640×360 (ffmpeg 7.1): 40×23 макроблока, обрезка снизу 8 строк.
	sps := []byte{0x67, 0x42, 0xc0, 0x16, 0xd9, 0x00, 0xa0, 0x2f, 0xf9, 0x70, 0x11, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x00, 0x03, 0x00, 0x1e, 0x0f, 0x16, 0x2e, 0x48}
	w, h, err := h264SPSSize(sps)
	if err != nil || w != 640 || h != 360 {
		t.Fatalf("got %dx%d err=%v", w, h, err)
	}
}

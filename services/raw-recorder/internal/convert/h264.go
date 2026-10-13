package convert

import (
	"errors"

	"github.com/pion/rtp/codecs"
)

// writeH264 — кадры H.264 (Annex B) из пакетов. Те же правила целостности,
// что у VP8: кадр целый, если номера пакетов подряд и последний с маркером;
// после потери — пропуск до ключевого кадра (IDR). Размер кадра — из SPS,
// который браузеры шлют перед каждым IDR.
func writeH264(pkts []packet, path string, relMs func(packet) int64, track *Track) error {
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
			// Свой разборщик на кадр: FU-A собирается внутри него, и обрывок
			// прошлого кадра не должен приклеиться к следующему.
			var depack codecs.H264Packet
			for _, p := range group {
				nal, err := depack.Unmarshal(p.pkt.Payload)
				if err != nil {
					complete = false
					break
				}
				data = append(data, nal...)
			}
		}
		contiguous := prevLastExt < 0 || group[0].ext == prevLastExt+1
		prevLastExt = group[len(group)-1].ext
		if !complete || len(data) == 0 {
			needKey = true
			track.Dropped++
			continue
		}
		key, sps := h264Keyframe(data)
		if !contiguous && !key {
			needKey = true
		}
		if needKey && !key {
			track.Dropped++
			continue
		}
		if key && sps != nil {
			if w, h, err := h264SPSSize(sps); err == nil {
				if w < minFrameSide || h < minFrameSide {
					// «Пустой» кадр SFU — не изображение (как у VP8).
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
		}
		needKey = false
		frames = append(frames, frame{ptsMs: relMs(group[0]), key: key, data: data})
	}
	return writeFrames(frames, path, "H264", track)
}

// h264Keyframe — есть ли в кадре IDR (тип 5); заодно первый SPS (тип 7).
func h264Keyframe(annexB []byte) (bool, []byte) {
	key := false
	var sps []byte
	for _, nal := range splitAnnexB(annexB) {
		if len(nal) == 0 {
			continue
		}
		switch nal[0] & 0x1f {
		case 5:
			key = true
		case 7:
			if sps == nil {
				sps = nal
			}
		}
	}
	return key, sps
}

// splitAnnexB — NAL-блоки между стартовыми кодами 00 00 01 / 00 00 00 01.
func splitAnnexB(b []byte) [][]byte {
	var out [][]byte
	start := -1
	for i := 0; i+2 < len(b); i++ {
		if b[i] == 0 && b[i+1] == 0 && b[i+2] == 1 {
			if start >= 0 {
				end := i
				if end > start && b[end-1] == 0 {
					end--
				}
				out = append(out, b[start:end])
			}
			start = i + 3
			i += 2
		}
	}
	if start >= 0 && start <= len(b) {
		out = append(out, b[start:])
	}
	return out
}

// ─── SPS: только то, что нужно для размера кадра ────────────────────────────

type bitReader struct {
	b   []byte
	pos int
}

var errSPS = errors.New("sps: truncated")

func (r *bitReader) bit() (uint, error) {
	if r.pos >= len(r.b)*8 {
		return 0, errSPS
	}
	v := (r.b[r.pos/8] >> (7 - uint(r.pos%8))) & 1
	r.pos++
	return uint(v), nil
}

func (r *bitReader) bits(n int) (uint, error) {
	var v uint
	for k := 0; k < n; k++ {
		b, err := r.bit()
		if err != nil {
			return 0, err
		}
		v = v<<1 | b
	}
	return v, nil
}

func (r *bitReader) ue() (uint, error) {
	zeros := 0
	for {
		b, err := r.bit()
		if err != nil {
			return 0, err
		}
		if b == 1 {
			break
		}
		zeros++
		if zeros > 31 {
			return 0, errSPS
		}
	}
	rest, err := r.bits(zeros)
	if err != nil {
		return 0, err
	}
	return (1<<uint(zeros) - 1) + rest, nil
}

func (r *bitReader) se() (int, error) {
	v, err := r.ue()
	if err != nil {
		return 0, err
	}
	if v%2 == 1 {
		return int(v+1) / 2, nil
	}
	return -int(v / 2), nil
}

// unescapeRBSP убирает байты защиты от стартового кода (00 00 03).
func unescapeRBSP(b []byte) []byte {
	out := make([]byte, 0, len(b))
	zeros := 0
	for _, c := range b {
		if zeros >= 2 && c == 3 {
			zeros = 0
			continue
		}
		if c == 0 {
			zeros++
		} else {
			zeros = 0
		}
		out = append(out, c)
	}
	return out
}

// h264SPSSize — ширина и высота кадра из SPS (с учётом обрезки).
func h264SPSSize(nal []byte) (uint16, uint16, error) {
	if len(nal) < 4 {
		return 0, 0, errSPS
	}
	r := &bitReader{b: unescapeRBSP(nal[1:])}
	profile, err := r.bits(8)
	if err != nil {
		return 0, 0, err
	}
	if _, err := r.bits(16); err != nil { // constraint flags + level
		return 0, 0, err
	}
	if _, err := r.ue(); err != nil { // seq_parameter_set_id
		return 0, 0, err
	}
	chroma := uint(1)
	switch profile {
	case 100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135:
		if chroma, err = r.ue(); err != nil {
			return 0, 0, err
		}
		if chroma == 3 {
			if _, err := r.bit(); err != nil {
				return 0, 0, err
			}
		}
		for k := 0; k < 2; k++ { // bit_depth_luma/chroma
			if _, err := r.ue(); err != nil {
				return 0, 0, err
			}
		}
		if _, err := r.bit(); err != nil { // qpprime_y_zero_transform_bypass
			return 0, 0, err
		}
		present, err := r.bit()
		if err != nil {
			return 0, 0, err
		}
		if present == 1 {
			lists := 8
			if chroma == 3 {
				lists = 12
			}
			for k := 0; k < lists; k++ {
				flag, err := r.bit()
				if err != nil {
					return 0, 0, err
				}
				if flag == 0 {
					continue
				}
				size := 16
				if k >= 6 {
					size = 64
				}
				last, next := 8, 8
				for n := 0; n < size; n++ {
					if next != 0 {
						delta, err := r.se()
						if err != nil {
							return 0, 0, err
						}
						next = (last + delta + 256) % 256
					}
					if next != 0 {
						last = next
					}
				}
			}
		}
	}
	if _, err := r.ue(); err != nil { // log2_max_frame_num_minus4
		return 0, 0, err
	}
	pocType, err := r.ue()
	if err != nil {
		return 0, 0, err
	}
	switch pocType {
	case 0:
		if _, err := r.ue(); err != nil {
			return 0, 0, err
		}
	case 1:
		if _, err := r.bit(); err != nil {
			return 0, 0, err
		}
		for k := 0; k < 2; k++ {
			if _, err := r.se(); err != nil {
				return 0, 0, err
			}
		}
		n, err := r.ue()
		if err != nil {
			return 0, 0, err
		}
		for k := uint(0); k < n; k++ {
			if _, err := r.se(); err != nil {
				return 0, 0, err
			}
		}
	}
	if _, err := r.ue(); err != nil { // max_num_ref_frames
		return 0, 0, err
	}
	if _, err := r.bit(); err != nil { // gaps_in_frame_num_value_allowed
		return 0, 0, err
	}
	wMbs, err := r.ue()
	if err != nil {
		return 0, 0, err
	}
	hMaps, err := r.ue()
	if err != nil {
		return 0, 0, err
	}
	frameMbsOnly, err := r.bit()
	if err != nil {
		return 0, 0, err
	}
	if frameMbsOnly == 0 {
		if _, err := r.bit(); err != nil {
			return 0, 0, err
		}
	}
	if _, err := r.bit(); err != nil { // direct_8x8_inference
		return 0, 0, err
	}
	crop, err := r.bit()
	if err != nil {
		return 0, 0, err
	}
	var cl, cr, ct, cb uint
	if crop == 1 {
		for _, v := range []*uint{&cl, &cr, &ct, &cb} {
			if *v, err = r.ue(); err != nil {
				return 0, 0, err
			}
		}
	}
	unitX, unitY := uint(1), 2-frameMbsOnly
	if chroma == 1 || chroma == 2 {
		unitX = 2
	}
	if chroma == 1 {
		unitY *= 2
	}
	w := (wMbs+1)*16 - (cl+cr)*unitX
	h := (2-frameMbsOnly)*(hMaps+1)*16 - (ct+cb)*unitY
	if w == 0 || h == 0 || w > 8192 || h > 8192 {
		return 0, 0, errSPS
	}
	return uint16(w), uint16(h), nil
}

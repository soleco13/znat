package render

import (
	"encoding/json"
	"os"
	"testing"

	"matis/raw-recorder/internal/apiclient"
	"matis/raw-recorder/internal/convert"
)

func cam(key, identity string, start, end int64) convert.Track {
	return convert.Track{Key: key, Identity: identity, Kind: "video", Source: "CAMERA", Supported: true, Frames: 10,
		StartMs: start, EndMs: end, Active: []convert.Interval{{StartMs: start, EndMs: end}}}
}

func TestSegmentsFollowSceneScreenAndCameras(t *testing.T) {
	g := NewGeometry(1280, 720)
	teacher := Participant{Identity: "t", Name: "Учитель", Staff: true, JoinedAt: "1"}
	student := Participant{Identity: "s", Name: "Ученик", JoinedAt: "2"}
	in := Inputs{
		DurationMs: 60_000,
		Presence: []PresenceChange{
			{AtMs: 0, Participants: []Participant{student, teacher}},
		},
		Scenes: []SceneChange{{AtMs: 0, Kind: "people"}, {AtMs: 20_000, Kind: "board"}},
		Tracks: []convert.Track{
			cam("cam-t", "t", 0, 60_000),
			cam("cam-s", "s", 10_000, 60_000),
			{Key: "scr", Identity: "t", Kind: "video", Source: "SCREEN_SHARE", Supported: true, Frames: 5,
				StartMs: 40_000, EndMs: 50_000, Active: []convert.Interval{{StartMs: 40_000, EndMs: 50_000}}},
		},
	}
	segs := BuildSegments(in, g)
	want := []struct {
		start int64
		main  MainKind
		video []string
	}{
		{0, MainNone, []string{"cam-t", ""}},           // ученик без камеры — заглушка
		{10_000, MainNone, []string{"cam-t", "cam-s"}}, // включил камеру
		{20_000, MainBoard, []string{"cam-t", "cam-s"}},
		{40_000, MainScreen, []string{"cam-t", "cam-s"}},
		{50_000, MainBoard, []string{"cam-t", "cam-s"}},
	}
	if len(segs) != len(want) {
		for _, s := range segs {
			t.Log(s)
		}
		t.Fatalf("segments = %d, want %d", len(segs), len(want))
	}
	for i, w := range want {
		s := segs[i]
		if s.StartMs != w.start || s.Main != w.main {
			t.Errorf("seg %d: %v", i, s)
		}
		// Персонал первым, как в RoomVideoGrid.
		if s.Tiles[0].Identity != "t" {
			t.Errorf("seg %d: first tile %s", i, s.Tiles[0].Identity)
		}
		for k, v := range w.video {
			if s.Tiles[k].Video != v {
				t.Errorf("seg %d tile %d video %q, want %q", i, k, s.Tiles[k].Video, v)
			}
		}
	}
	if segs[3].Screen != "scr" {
		t.Errorf("screen = %q", segs[3].Screen)
	}
	// В ленте (есть главная область) плитки 190×106 справа.
	r := segs[2].Tiles[0].Rect
	if r.W != 190 || r.X != 1280-12-190 {
		t.Errorf("rail tile %+v", r)
	}
	if segs[4].EndMs != 60_000 {
		t.Errorf("last end %d", segs[4].EndMs)
	}
}

func TestRailShowsFiveAndCountsHidden(t *testing.T) {
	g := NewGeometry(1280, 720)
	var people []Participant
	for i := 0; i < 31; i++ {
		people = append(people, Participant{Identity: string(rune('a' + i)), JoinedAt: string(rune('a' + i))})
	}
	segs := BuildSegments(Inputs{
		DurationMs: 1000,
		Presence:   []PresenceChange{{AtMs: 0, Participants: people}},
		Scenes:     []SceneChange{{AtMs: 0, Kind: "board"}},
	}, g)
	if len(segs) != 1 || len(segs[0].Tiles) != 5 || segs[0].Hidden != 26 {
		t.Fatalf("%v", segs)
	}
	grid := BuildSegments(Inputs{
		DurationMs: 1000,
		Presence:   []PresenceChange{{AtMs: 0, Participants: people}},
		Scenes:     []SceneChange{{AtMs: 0, Kind: "people"}},
	}, g)
	if grid[0].Tiles[0].Rect.W < 200 {
		t.Errorf("grid tile too small: %+v", grid[0].Tiles[0].Rect)
	}
	if len(grid[0].Tiles)+grid[0].Hidden != 31 {
		t.Errorf("grid tiles %d hidden %d", len(grid[0].Tiles), grid[0].Hidden)
	}
}

func ev(ts int64, kind string, payload any) apiclient.JournalEvent {
	raw, _ := json.Marshal(payload)
	return apiclient.JournalEvent{TsMs: ts, Kind: kind, Payload: raw}
}

func TestJournalReducers(t *testing.T) {
	t0 := int64(1_000_000)
	events := []apiclient.JournalEvent{
		ev(t0+5, "journal_started", map[string]string{"reason": "start"}),
		ev(t0+6, "lesson_snapshot", map[string]any{"stage": "people", "participants": []map[string]any{
			{"userId": "t", "fullName": "Учитель", "kind": "staff", "connected": true, "joinedAt": "1"},
		}}),
		ev(t0+1000, "room_event", map[string]any{"type": "participant_joined", "participant": map[string]any{
			"userId": "s", "fullName": "Ученик", "kind": "guest", "connected": true, "joinedAt": "2"}}),
		ev(t0+2000, "room_event", map[string]any{"type": "stage_changed", "stage": "board"}),
		ev(t0+2500, "yjs_update", nil),
		ev(t0+3000, "room_event", map[string]any{"type": "activity_started", "activityId": "a"}),
		ev(t0+4000, "room_event", map[string]any{"type": "participant_left", "userId": "s"}),
		ev(t0+5000, "room_event", map[string]any{"type": "stage_changed", "stage": "people"}),
		ev(t0+30000, "journal_heartbeat", map[string]any{"dropped": 0}),
	}
	presence := PresenceFromJournal(events, t0)
	if len(presence) != 3 || len(presence[1].Participants) != 2 || len(presence[2].Participants) != 1 {
		t.Fatalf("presence %+v", presence)
	}
	scenes, changes := ScenesFromJournal(events, t0, 60_000)
	kinds := ""
	for _, s := range scenes {
		kinds += s.Kind + ","
	}
	if kinds != "people,board,activity,people," {
		t.Errorf("scenes %s", kinds)
	}
	if len(changes) != 1 || changes[0] != 2500 {
		t.Errorf("changes %v", changes)
	}
	c := CheckJournal(events)
	if c.Starts != 1 || c.MaxGapMs != 25000 {
		t.Errorf("completeness %+v", c)
	}
}

func TestConcatListHoldsFramesUntilNext(t *testing.T) {
	dir := t.TempDir()
	frames := []Frame{{AtMs: 0, Path: "a.png"}, {AtMs: 1500, Path: "b.png"}, {AtMs: 9000, Path: "c.png"}}
	path := dir + "/list.txt"
	if err := writeConcatList(path, frames, 1000, 5000); err != nil {
		t.Fatal(err)
	}
	data, _ := readFile(path)
	want := "ffconcat version 1.0\nfile 'a.png'\nduration 0.500\nfile 'b.png'\nduration 3.500\nfile 'b.png'\n"
	if data != want {
		t.Errorf("got:\n%s", data)
	}
}

func readFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	return string(b), err
}

func TestSplitLongSegments(t *testing.T) {
	segs := splitLong([]Segment{{StartMs: 0, EndMs: 1000}, {StartMs: 1000, EndMs: 11000}}, 3000)
	if len(segs) != 5 || segs[1].StartMs != 1000 || segs[4].EndMs != 11000 {
		t.Fatalf("%v", segs)
	}
	for i := 1; i < len(segs); i++ {
		if segs[i].StartMs != segs[i-1].EndMs {
			t.Fatalf("gap at %d", i)
		}
	}
}

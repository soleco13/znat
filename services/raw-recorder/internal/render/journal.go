package render

import (
	"encoding/json"
	"sort"

	"matis/raw-recorder/internal/apiclient"
)

type participantSnapshot struct {
	UserID    string `json:"userId"`
	FullName  string `json:"fullName"`
	Kind      string `json:"kind"`
	Connected bool   `json:"connected"`
	JoinedAt  string `json:"joinedAt"`
}

type roomMessage struct {
	Type         string                `json:"type"`
	Participants []participantSnapshot `json:"participants"`
	Participant  *participantSnapshot  `json:"participant"`
	UserID       string                `json:"userId"`
}

// PresenceFromJournal — состав подключённых участников во времени (мс от t0),
// тем же редьюсером, что шаблон записи `/egress` (EgressStage.handleMessage).
func PresenceFromJournal(events []apiclient.JournalEvent, t0Ms int64) []PresenceChange {
	state := map[string]participantSnapshot{}
	var out []PresenceChange
	emit := func(tsMs int64) {
		at := tsMs - t0Ms
		if at < 0 {
			at = 0
		}
		var list []Participant
		for _, p := range state {
			if !p.Connected {
				continue
			}
			list = append(list, Participant{Identity: p.UserID, Name: p.FullName, Staff: p.Kind == "staff", JoinedAt: p.JoinedAt})
		}
		sort.Slice(list, func(i, j int) bool { return list[i].Identity < list[j].Identity })
		if n := len(out); n > 0 && out[n-1].AtMs == at {
			out[n-1].Participants = list
			return
		}
		out = append(out, PresenceChange{AtMs: at, Participants: list})
	}
	for _, ev := range events {
		switch ev.Kind {
		case "lesson_snapshot":
			var snap struct {
				Participants []participantSnapshot `json:"participants"`
			}
			if json.Unmarshal(ev.Payload, &snap) != nil {
				continue
			}
			state = map[string]participantSnapshot{}
			for _, p := range snap.Participants {
				state[p.UserID] = p
			}
			emit(ev.TsMs)
		case "room_event":
			var msg roomMessage
			if json.Unmarshal(ev.Payload, &msg) != nil {
				continue
			}
			switch msg.Type {
			case "presence":
				state = map[string]participantSnapshot{}
				for _, p := range msg.Participants {
					state[p.UserID] = p
				}
			case "participant_joined", "participant_updated":
				if msg.Participant == nil {
					continue
				}
				state[msg.Participant.UserID] = *msg.Participant
			case "participant_left", "participant_removed":
				delete(state, msg.UserID)
			default:
				continue
			}
			emit(ev.TsMs)
		}
	}
	return out
}

// JournalCompleteness — признаки полноты журнала для метрик и проверки.
type JournalCompleteness struct {
	Events         int   `json:"events"`
	Starts         int   `json:"starts"`
	Resumes        int   `json:"resumes"`
	MaxGapMs       int64 `json:"maxHeartbeatGapMs"`
	Dropped        int64 `json:"dropped"`
	HasYjsKeyframe bool  `json:"hasYjsKeyframe"`
}

// CheckJournal — непрерывность по heartbeat (раз в 10 с), рестарты API, потери буфера.
func CheckJournal(events []apiclient.JournalEvent) JournalCompleteness {
	c := JournalCompleteness{Events: len(events)}
	var last int64
	for _, ev := range events {
		if last != 0 && ev.TsMs-last > c.MaxGapMs {
			c.MaxGapMs = ev.TsMs - last
		}
		last = ev.TsMs
		switch ev.Kind {
		case "journal_started":
			var p struct {
				Reason string `json:"reason"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			if p.Reason == "resume" {
				c.Resumes++
			} else {
				c.Starts++
			}
		case "journal_heartbeat", "journal_stopped":
			var p struct {
				Dropped int64 `json:"dropped"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			if p.Dropped > c.Dropped {
				c.Dropped = p.Dropped
			}
		case "yjs_snapshot":
			c.HasYjsKeyframe = true
		}
	}
	return c
}

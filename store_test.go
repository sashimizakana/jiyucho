package main

import (
	"encoding/json"
	"testing"
)

func raws(ss ...string) []json.RawMessage {
	out := []json.RawMessage{}
	for _, s := range ss {
		out = append(out, json.RawMessage(s))
	}
	return out
}

func strokesOf(t *testing.T, s *Store, id string) string {
	t.Helper()
	_, b, err := s.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestStrokesAppendAndReplace(t *testing.T) {
	s, _ := NewStore(t.TempDir())
	m, _ := s.Create("", "")
	ip := func(n int) *int { return &n }

	save := func(base int, app ...string) error {
		_, err := s.Save(m.ID, &SaveRequest{Base: ip(base), Append: raws(app...)})
		return err
	}
	if err := save(0, `{"a":1}`, "{\"a\":\n2}", `{"a":3}`); err != nil { // 改行入りでも1行に収まる
		t.Fatal(err)
	}
	if got := strokesOf(t, s, m.ID); got != `[{"a":1},{"a":2},{"a":3}]` {
		t.Fatal(got)
	}
	if err := save(3, `{"a":4}`); err != nil { // 追記
		t.Fatal(err)
	}
	if err := save(2, `{"b":1}`); err != nil { // undo 後に別のストロークを描いた
		t.Fatal(err)
	}
	if got := strokesOf(t, s, m.ID); got != `[{"a":1},{"a":2},{"b":1}]` {
		t.Fatal(got)
	}
	if err := save(9); err == nil { // サーバーより先の位置は拒否
		t.Fatal("want mismatch error")
	}
	if err := save(0); err != nil {
		t.Fatal(err)
	}
	if got := strokesOf(t, s, m.ID); got != `[]` {
		t.Fatal(got)
	}
}

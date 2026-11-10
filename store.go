package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type BBox struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

type Meta struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Paper       string    `json:"paper"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	BBox        *BBox     `json:"bbox,omitempty"`
	CacheScale  float64   `json:"cacheScale,omitempty"`
	StrokeCount int       `json:"strokeCount"`
}

type SaveRequest struct {
	Title       string          `json:"title"`
	Paper       string          `json:"paper"`
	Strokes     json.RawMessage `json:"strokes"`
	BBox        *BBox           `json:"bbox"`
	CacheScale  float64         `json:"cacheScale"`
	StrokeCount int             `json:"strokeCount"`
	Layers      string          `json:"layers"` // data URL (透明PNG・描画範囲のみ)
	Thumb       string          `json:"thumb"`  // data URL
}

const DefaultPaper = "#e8dcbc"

type Store struct {
	root string
	mu   sync.Mutex
}

func NewStore(root string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(root, "images"), 0o755); err != nil {
		return nil, err
	}
	return &Store{root: root}, nil
}

func (s *Store) dir(id string) (string, error) {
	if id == "" || strings.ContainsAny(id, `/\.`) {
		return "", errors.New("invalid id")
	}
	return filepath.Join(s.root, "images", id), nil
}

func newID() string {
	b := make([]byte, 4)
	rand.Read(b)
	return time.Now().Format("20060102-150405") + "-" + hex.EncodeToString(b)
}

func writeJSON(path string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *Store) readMeta(id string) (*Meta, error) {
	d, err := s.dir(id)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(d, "meta.json"))
	if err != nil {
		return nil, err
	}
	var m Meta
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (s *Store) List() []Meta {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, _ := os.ReadDir(filepath.Join(s.root, "images"))
	out := []Meta{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if m, err := s.readMeta(e.Name()); err == nil {
			out = append(out, *m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

func (s *Store) Create(title, paper string) (*Meta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if paper == "" {
		paper = DefaultPaper
	}
	now := time.Now()
	m := &Meta{ID: newID(), Title: title, Paper: paper, CreatedAt: now, UpdatedAt: now}
	d, _ := s.dir(m.ID)
	if err := os.MkdirAll(d, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(d, "strokes.json"), []byte("[]"), 0o644); err != nil {
		return nil, err
	}
	return m, writeJSON(filepath.Join(d, "meta.json"), m)
}

func (s *Store) Get(id string) (*Meta, json.RawMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.readMeta(id)
	if err != nil {
		return nil, nil, err
	}
	d, _ := s.dir(id)
	strokes, err := os.ReadFile(filepath.Join(d, "strokes.json"))
	if err != nil {
		strokes = []byte("[]")
	}
	return m, strokes, nil
}

func decodeDataURL(u string) ([]byte, error) {
	i := strings.Index(u, ",")
	if i < 0 {
		return nil, errors.New("bad data url")
	}
	return base64.StdEncoding.DecodeString(u[i+1:])
}

func (s *Store) Save(id string, r *SaveRequest) (*Meta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.readMeta(id)
	if err != nil {
		return nil, err
	}
	d, _ := s.dir(id)
	m.Title = r.Title
	if r.Paper != "" {
		m.Paper = r.Paper
	}
	m.BBox = r.BBox
	m.CacheScale = r.CacheScale
	m.StrokeCount = r.StrokeCount
	m.UpdatedAt = time.Now()
	if len(r.Strokes) > 0 {
		if err := os.WriteFile(filepath.Join(d, "strokes.json"), r.Strokes, 0o644); err != nil {
			return nil, err
		}
	}
	if r.BBox == nil {
		os.Remove(filepath.Join(d, "layers.png"))
	}
	for name, u := range map[string]string{"layers.png": r.Layers, "thumb.png": r.Thumb} {
		if u == "" {
			continue
		}
		b, err := decodeDataURL(u)
		if err != nil {
			return nil, err
		}
		if err := os.WriteFile(filepath.Join(d, name), b, 0o644); err != nil {
			return nil, err
		}
	}
	return m, writeJSON(filepath.Join(d, "meta.json"), m)
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.dir(id)
	if err != nil {
		return err
	}
	return os.RemoveAll(d)
}

func (s *Store) File(id, name string) string {
	d, err := s.dir(id)
	if err != nil {
		return ""
	}
	return filepath.Join(d, name)
}

func (s *Store) settingsPath() string { return filepath.Join(s.root, "settings.json") }

func (s *Store) Settings() json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.settingsPath())
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}

func (s *Store) SaveSettings(b []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return os.WriteFile(s.settingsPath(), b, 0o644)
}

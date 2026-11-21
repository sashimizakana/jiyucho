package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
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
	// 印刷枠の設定と前回の印刷内容(フロントエンドが決めた形のまま保存する)
	Frame json.RawMessage `json:"frame,omitempty"`
}

type SaveRequest struct {
	Title string `json:"title"`
	Paper string `json:"paper"`
	// ストロークは差分で保存する: 先頭 Base 本を残し、その後ろを Append で置き換える
	// (Base が nil ならストロークは変更しない)
	Base        *int              `json:"base"`
	Append      []json.RawMessage `json:"append"`
	BBox        *BBox             `json:"bbox"`
	CacheScale  float64           `json:"cacheScale"`
	StrokeCount int               `json:"strokeCount"`
	Layers      string            `json:"layers"` // data URL (透明PNG・描画範囲のみ)
	Thumb       string            `json:"thumb"`  // data URL
	// 貼り付け画像の配置 [{id,x,y,w,h}...] (配列の順が重なり順)。nil なら変更しない
	Pics json.RawMessage `json:"pics"`
	// 印刷枠。nil なら変更しない
	Frame json.RawMessage `json:"frame"`
}

const (
	DefaultPaper = "#e8dcbc"
	strokesFile  = "strokes.jsonl" // 1行1ストロークの追記ログ
)

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
	if err := os.WriteFile(filepath.Join(d, strokesFile), nil, 0o644); err != nil {
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
	strokes, err := readStrokes(d)
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
	if len(r.Frame) > 0 {
		m.Frame = r.Frame
	}
	m.BBox = r.BBox
	m.CacheScale = r.CacheScale
	m.StrokeCount = r.StrokeCount
	m.UpdatedAt = time.Now()
	if r.Base != nil {
		if err := writeStrokes(d, *r.Base, r.Append); err != nil {
			return nil, err
		}
	}
	if len(r.Pics) > 0 {
		if err := writePics(d, r.Pics); err != nil {
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

// ---------- strokes.jsonl ----------

var errBaseMismatch = errors.New("base mismatch")

// 先頭 n 行ぶん(改行終端のもの)の直後のバイト位置を返す。行が足りなければ errBaseMismatch
func lineOffset(f *os.File, n int) (int64, error) {
	if n == 0 {
		return 0, nil
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return 0, err
	}
	buf := make([]byte, 64*1024)
	var off int64
	for {
		k, err := f.Read(buf)
		for i := 0; i < k; {
			j := bytes.IndexByte(buf[i:k], '\n')
			if j < 0 {
				break
			}
			i += j + 1
			if n--; n == 0 {
				return off + int64(i), nil
			}
		}
		off += int64(k)
		if err == io.EOF {
			return 0, errBaseMismatch
		}
		if err != nil {
			return 0, err
		}
	}
}

// 先頭 base 本を残し、それ以降を app で置き換える
func writeStrokes(d string, base int, app []json.RawMessage) error {
	if base < 0 {
		return errBaseMismatch
	}
	f, err := os.OpenFile(filepath.Join(d, strokesFile), os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	off, err := lineOffset(f, base)
	if err != nil {
		return err
	}
	if err := f.Truncate(off); err != nil {
		return err
	}
	if _, err := f.Seek(off, io.SeekStart); err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	var line bytes.Buffer
	for _, st := range app {
		line.Reset()
		if err := json.Compact(&line, st); err != nil { // 1行に収める
			return err
		}
		line.WriteByte('\n')
		w.Write(line.Bytes())
	}
	return w.Flush()
}

// JSON配列 "[s1,s2,...]" の形で全ストロークを返す(改行で終わっていない書きかけの末尾は無視)
func readStrokes(d string) ([]byte, error) {
	f, err := os.Open(filepath.Join(d, strokesFile))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out bytes.Buffer
	out.WriteByte('[')
	r := bufio.NewReaderSize(f, 64*1024)
	first := true
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 0 && line[len(line)-1] == '\n' {
			if t := bytes.TrimSpace(line); len(t) > 0 {
				if !first {
					out.WriteByte(',')
				}
				first = false
				out.Write(t)
			}
		}
		if err != nil {
			break
		}
	}
	out.WriteByte(']')
	return out.Bytes(), nil
}

// ---------- 貼り付け画像 ----------

const picsFile = "pics.json"

func (s *Store) Pics(id string) json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.dir(id)
	if err != nil {
		return json.RawMessage("[]")
	}
	b, err := os.ReadFile(filepath.Join(d, picsFile))
	if err != nil || !json.Valid(b) {
		return json.RawMessage("[]")
	}
	return b
}

func validPicID(pid string) bool {
	if pid == "" || len(pid) > 64 {
		return false
	}
	for _, c := range pid {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func (s *Store) PicPath(id, pid string) string {
	d, err := s.dir(id)
	if err != nil || !validPicID(pid) {
		return ""
	}
	return filepath.Join(d, "pics", pid+".png")
}

func (s *Store) SavePic(id, pid string, r io.Reader) error {
	p := s.PicPath(id, pid)
	if p == "" {
		return errors.New("invalid id")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.readMeta(id); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	b, err := io.ReadAll(io.LimitReader(r, 64<<20))
	if err != nil {
		return err
	}
	return os.WriteFile(p, b, 0o644)
}

// 配置を保存し、どこからも参照されなくなった画像ファイルを消す
func writePics(d string, raw json.RawMessage) error {
	var list []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(d, picsFile), raw, 0o644); err != nil {
		return err
	}
	keep := map[string]bool{}
	for _, p := range list {
		keep[p.ID+".png"] = true
	}
	entries, _ := os.ReadDir(filepath.Join(d, "pics"))
	for _, e := range entries {
		if !keep[e.Name()] {
			os.Remove(filepath.Join(d, "pics", e.Name()))
		}
	}
	return nil
}

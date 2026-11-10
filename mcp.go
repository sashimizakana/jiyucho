package main

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"os"
	"strconv"
	"strings"
)

type rpcReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResp struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcErr         `json:"error,omitempty"`
}

type rpcErr struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type content map[string]any

func textContent(s string) content { return content{"type": "text", "text": s} }

func toolResult(isErr bool, items ...content) map[string]any {
	return map[string]any{"content": items, "isError": isErr}
}

var mcpTools = []map[string]any{
	{
		"name":        "list_images",
		"description": "自由帳に保存されている画像の一覧を新しい順に返す。queryを指定するとタイトル(またはID)の部分一致で絞り込む。",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string", "description": "検索語 (大文字小文字を区別しない。省略時は全件)"},
				"limit": map[string]any{"type": "integer", "description": "最大件数 (既定 50)"},
			},
		},
	},
	{
		"name":        "get_image",
		"description": "IDを指定して画像(PNG)を取得する。",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"id"},
			"properties": map[string]any{
				"id": map[string]any{"type": "string"},
				"background": map[string]any{"type": "string",
					"description": "背景色。'#rrggbb' / '#rrggbbaa' / 'transparent'。省略時は描画時の紙の色。"},
			},
		},
	},
}

func runMCP(store *Store, in io.Reader, out io.Writer) {
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	enc := json.NewEncoder(out)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var req rpcReq
		if err := json.Unmarshal(line, &req); err != nil {
			enc.Encode(rpcResp{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcErr{-32700, "parse error"}})
			continue
		}
		if len(req.ID) == 0 { // 通知には応答しない
			continue
		}
		resp := rpcResp{JSONRPC: "2.0", ID: req.ID}
		switch req.Method {
		case "initialize":
			var p struct {
				ProtocolVersion string `json:"protocolVersion"`
			}
			json.Unmarshal(req.Params, &p)
			if p.ProtocolVersion == "" {
				p.ProtocolVersion = "2024-11-05"
			}
			resp.Result = map[string]any{
				"protocolVersion": p.ProtocolVersion,
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "jiyucho", "version": "1.0.0"},
			}
		case "ping":
			resp.Result = map[string]any{}
		case "tools/list":
			resp.Result = map[string]any{"tools": mcpTools}
		case "tools/call":
			var p struct {
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"arguments"`
			}
			json.Unmarshal(req.Params, &p)
			resp.Result = callTool(store, p.Name, p.Arguments)
		default:
			resp.Error = &rpcErr{-32601, "method not found: " + req.Method}
		}
		enc.Encode(resp)
	}
}

func metaLine(m Meta) map[string]any {
	title := m.Title
	if title == "" {
		title = "(無題)"
	}
	o := map[string]any{
		"id": m.ID, "title": title, "paper": m.Paper,
		"createdAt": m.CreatedAt, "updatedAt": m.UpdatedAt, "strokes": m.StrokeCount,
	}
	if m.BBox != nil {
		o["bbox"] = m.BBox
	}
	return o
}

func callTool(store *Store, name string, args json.RawMessage) map[string]any {
	switch name {
	case "list_images":
		var a struct {
			Limit int    `json:"limit"`
			Query string `json:"query"`
		}
		json.Unmarshal(args, &a)
		if a.Limit <= 0 {
			a.Limit = 50
		}
		q := strings.ToLower(a.Query)
		res := []map[string]any{}
		for _, m := range store.List() {
			if q != "" && !strings.Contains(strings.ToLower(m.Title), q) && !strings.Contains(strings.ToLower(m.ID), q) {
				continue
			}
			res = append(res, metaLine(m))
			if len(res) >= a.Limit {
				break
			}
		}
		b, _ := json.MarshalIndent(res, "", "  ")
		return toolResult(false, textContent(string(b)))
	case "get_image":
		var a struct {
			ID         string `json:"id"`
			Background string `json:"background"`
		}
		json.Unmarshal(args, &a)
		m, _, err := store.Get(a.ID)
		if err != nil {
			return toolResult(true, textContent("画像が見つかりません: "+a.ID))
		}
		bg := m.Paper
		if a.Background != "" && a.Background != "paper" {
			bg = a.Background
		}
		c, err := parseColor(bg)
		if err != nil {
			return toolResult(true, textContent(err.Error()))
		}
		data, err := composite(store.File(a.ID, "layers.png"), c)
		if err != nil {
			return toolResult(true, textContent("画像生成に失敗: "+err.Error()))
		}
		info, _ := json.Marshal(metaLine(*m))
		return toolResult(false,
			textContent(string(info)),
			content{"type": "image", "data": base64.StdEncoding.EncodeToString(data), "mimeType": "image/png"})
	}
	return toolResult(true, textContent("unknown tool: "+name))
}

func parseColor(s string) (color.NRGBA, error) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "transparent" || s == "none" {
		return color.NRGBA{}, nil
	}
	h := strings.TrimPrefix(s, "#")
	if len(h) == 3 || len(h) == 4 {
		var e string
		for _, r := range h {
			e += string(r) + string(r)
		}
		h = e
	}
	if len(h) != 6 && len(h) != 8 {
		return color.NRGBA{}, fmt.Errorf("背景色を解釈できません: %q ('#rrggbb' か 'transparent' を指定)", s)
	}
	v, err := strconv.ParseUint(h, 16, 32)
	if err != nil {
		return color.NRGBA{}, fmt.Errorf("背景色を解釈できません: %q", s)
	}
	if len(h) == 6 {
		return color.NRGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 255}, nil
	}
	return color.NRGBA{uint8(v >> 24), uint8(v >> 16), uint8(v >> 8), uint8(v)}, nil
}

// 透明PNG(描画レイヤー)に背景色を敷いて PNG を返す。
func composite(layersPath string, bg color.NRGBA) ([]byte, error) {
	var layers image.Image
	if f, err := os.Open(layersPath); err == nil {
		defer f.Close()
		layers, err = png.Decode(f)
		if err != nil {
			return nil, err
		}
	}
	w, h := 256, 256
	if layers != nil {
		w, h = layers.Bounds().Dx(), layers.Bounds().Dy()
	}
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(bg), image.Point{}, draw.Src)
	if layers != nil {
		draw.Draw(dst, dst.Bounds(), layers, layers.Bounds().Min, draw.Over)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, dst); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

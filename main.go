package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

func defaultDataDir() string {
	if d, err := os.UserConfigDir(); err == nil {
		dir := filepath.Join(d, "jiyucho")
		// 旧名称(kantan-sketch)のデータがあれば引き継ぐ
		old := filepath.Join(d, "kantan-sketch")
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			if _, err := os.Stat(old); err == nil {
				_ = os.Rename(old, dir)
			}
		}
		return dir
	}
	return "data"
}

func main() {
	dataDir := flag.String("data", defaultDataDir(), "データ保存先ディレクトリ")
	port := flag.Int("port", 0, "待ち受けポート (0=自動)")
	noOpen := flag.Bool("no-open", false, "ブラウザを自動で開かない")
	mcp := flag.Bool("mcp", false, "stdio MCPサーバーとして起動")
	flag.Parse()
	if flag.NArg() > 0 && flag.Arg(0) == "mcp" {
		*mcp = true
	}

	store, err := NewStore(*dataDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "データディレクトリを準備できません:", err)
		os.Exit(1)
	}
	if *mcp {
		runMCP(store, os.Stdin, os.Stdout)
		return
	}
	runServer(store, *port, !*noOpen, *dataDir)
}

func runServer(store *Store, port int, open bool, dataDir string) {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	url := "http://" + ln.Addr().String() + "/"

	mux := http.NewServeMux()
	sub, _ := fs.Sub(webFS, "web")
	mux.Handle("/", noCache(http.FileServer(http.FS(sub))))

	// ブラウザの接続を監視: 全タブが閉じたら終了する
	var mu sync.Mutex
	conns := 0
	quit := func() { fmt.Println("ブラウザが閉じられたので終了します"); os.Exit(0) }
	timer := time.AfterFunc(60*time.Second, quit) // 起動後ずっと接続が無い場合
	mux.HandleFunc("GET /api/live", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		conns++
		timer.Stop()
		mu.Unlock()
		defer func() {
			mu.Lock()
			conns--
			if conns == 0 {
				timer.Reset(3 * time.Second) // リロード猶予
			}
			mu.Unlock()
		}()
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		fl, _ := w.(http.Flusher)
		tk := time.NewTicker(10 * time.Second)
		defer tk.Stop()
		fmt.Fprint(w, ": hi\n\n")
		fl.Flush()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-tk.C:
				fmt.Fprint(w, ": ping\n\n")
				fl.Flush()
			}
		}
	})

	jsonOut := func(w http.ResponseWriter, v any, err error) {
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(v)
	}
	mux.HandleFunc("GET /api/images", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, store.List(), nil)
	})
	mux.HandleFunc("POST /api/images", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Title, Paper string }
		json.NewDecoder(r.Body).Decode(&req)
		m, err := store.Create(req.Title, req.Paper)
		jsonOut(w, m, err)
	})
	mux.HandleFunc("GET /api/images/{id}", func(w http.ResponseWriter, r *http.Request) {
		m, strokes, err := store.Get(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), 404)
			return
		}
		jsonOut(w, map[string]any{"meta": m, "strokes": strokes}, nil)
	})
	mux.HandleFunc("PUT /api/images/{id}", func(w http.ResponseWriter, r *http.Request) {
		var req SaveRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		m, err := store.Save(r.PathValue("id"), &req)
		jsonOut(w, m, err)
	})
	mux.HandleFunc("DELETE /api/images/{id}", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, map[string]bool{"ok": true}, store.Delete(r.PathValue("id")))
	})
	mux.HandleFunc("GET /api/images/{id}/thumb.png", func(w http.ResponseWriter, r *http.Request) {
		p := store.File(r.PathValue("id"), "thumb.png")
		if _, err := os.Stat(p); err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, p)
	})
	mux.HandleFunc("GET /api/settings", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(store.Settings())
	})
	mux.HandleFunc("PUT /api/settings", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if !json.Valid(b) {
			http.Error(w, "invalid json", 400)
			return
		}
		jsonOut(w, map[string]bool{"ok": true}, store.SaveSettings(b))
	})

	fmt.Println("自由帳:", url)
	fmt.Println("データ保存先:", dataDir)
	if open {
		go openBrowser(url)
	}
	http.Serve(ln, mux)
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		h.ServeHTTP(w, r)
	})
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start()
}

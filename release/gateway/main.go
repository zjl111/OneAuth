package main

import (
	"flag"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"strings"
)

var backendURL = flag.String("backend", "http://backend:8080", "backend upstream")
var staticDir = flag.String("static", "/app/site", "directory with built frontend assets")

func main() {
	flag.Parse()

	target, err := url.Parse(*backendURL)
	if err != nil {
		log.Fatalf("parse backend url: %v", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
	}

	proxy.ModifyResponse = func(resp *http.Response) error {
		return nil
	}

	fs := http.FileServer(http.Dir(*staticDir))
	index, err := os.ReadFile(path.Join(*staticDir, "index.html"))
	if err != nil {
		log.Fatalf("read index.html: %v", err)
	}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if shouldProxy(r.URL.Path) {
			proxy.ServeHTTP(w, r)
			return
		}

		if hasFile(*staticDir, r.URL.Path) {
			fs.ServeHTTP(w, r)
			return
		}

		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	})

	addr := ":80"
	log.Printf("gateway listening on %s, backend=%s", addr, target.String())
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}

func shouldProxy(p string) bool {
	switch {
	case p == "/oauth" || strings.HasPrefix(p, "/oauth/"):
		return true
	case p == "/api" || strings.HasPrefix(p, "/api/"):
		return true
	case p == "/.well-known" || strings.HasPrefix(p, "/.well-known/"):
		return true
	case p == "/cas" || strings.HasPrefix(p, "/cas/"):
		return true
	case p == "/saml" || strings.HasPrefix(p, "/saml/"):
		return true
	case p == "/wecom" || strings.HasPrefix(p, "/wecom/"):
		return true
	case p == "/uploads" || strings.HasPrefix(p, "/uploads/"):
		return true
	default:
		return false
	}
}

func hasFile(root, reqPath string) bool {
	clean := path.Clean(strings.TrimPrefix(reqPath, "/"))
	if clean == "." || clean == "/" {
		return false
	}
	info, err := os.Stat(path.Join(root, clean))
	return err == nil && !info.IsDir()
}

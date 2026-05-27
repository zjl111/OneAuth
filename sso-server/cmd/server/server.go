package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

func startServer(r *gin.Engine, addr string) *http.Server {
	srv := &http.Server{Addr: addr, Handler: r}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()
	return srv
}

package main

import (
	"log"
	"net/http"

	httpapi "github.com/pinetortoise/cs5224/go-api/internal/http"
)

func main() {
	addr := ":8080"
	server := &http.Server{
		Addr:    addr,
		Handler: httpapi.NewRouter(),
	}

	log.Printf("go-api listening on %s", addr)
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

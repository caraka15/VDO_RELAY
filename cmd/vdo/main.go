package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"vdo-relay/internal/app"
)

func main() {
	application, err := app.New(app.DefaultConfig())
	if err != nil {
		log.Fatal(err)
	}
	defer application.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := application.StartMedia(ctx); err != nil {
		log.Printf("MediaMTX unavailable: %v", err)
	}
	go application.ServeInternal(ctx)

	if err := application.ServePublic(ctx); err != nil && ctx.Err() == nil {
		log.Fatal(err)
	}
}

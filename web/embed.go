package web

import "embed"

// Files contains the production frontend copied into web/dist during the image build.
// The checked-in placeholder keeps `go test ./...` useful before a frontend build.
//
//go:embed dist/*
var Files embed.FS

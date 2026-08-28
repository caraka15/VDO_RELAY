package app

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	defaultUser      = "admin"
	defaultPassword  = "admin"
	maxActiveStreams = 8
)

type Config struct {
	DataDir          string
	MediaMTXBinary   string
	PublicAddr       string
	InternalAddr     string
	TLSCertFile      string
	TLSKeyFile       string
	ControlURL       string
	MoQPublicBaseURL string
	SRTPublicHost    string
	PublicOrigin     string
	MaxActiveStreams int
}

func DefaultConfig() Config {
	dataDir := os.Getenv("VDO_DATA_DIR")
	if dataDir == "" {
		if _, err := os.Stat("/data"); err == nil {
			dataDir = "/data"
		} else {
			dataDir = "./data"
		}
	}

	certFile := envOr("VDO_TLS_CERT_FILE", "/certs/server.crt")
	keyFile := envOr("VDO_TLS_KEY_FILE", "/certs/server.key")
	publicAddr := envOr("VDO_PUBLIC_ADDR", ":8443")
	if _, err := os.Stat(certFile); err != nil {
		if _, keyErr := os.Stat(keyFile); keyErr != nil && os.Getenv("VDO_PUBLIC_ADDR") == "" {
			publicAddr = ":8081"
		}
	}

	maxStreams := maxActiveStreams
	if value := os.Getenv("VDO_MAX_STREAMS"); value != "" {
		if _, err := fmt.Sscanf(value, "%d", &maxStreams); err != nil || maxStreams < 1 {
			maxStreams = maxActiveStreams
		}
	}

	return Config{
		DataDir:          dataDir,
		MediaMTXBinary:   envOr("VDO_MEDIAMTX_BIN", "/usr/local/bin/mediamtx"),
		PublicAddr:       publicAddr,
		InternalAddr:     envOr("VDO_INTERNAL_ADDR", "127.0.0.1:8080"),
		TLSCertFile:      certFile,
		TLSKeyFile:       keyFile,
		ControlURL:       envOr("VDO_MEDIAMTX_CONTROL_URL", "http://127.0.0.1:9997"),
		MoQPublicBaseURL: strings.TrimRight(os.Getenv("VDO_MOQ_PUBLIC_BASE_URL"), "/"),
		SRTPublicHost:    os.Getenv("VDO_SRT_PUBLIC_HOST"),
		PublicOrigin:     strings.TrimRight(os.Getenv("VDO_PUBLIC_ORIGIN"), "/"),
		MaxActiveStreams: maxStreams,
	}
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

type App struct {
	cfg             Config
	db              *sql.DB
	media           *mediaManager
	publicHandler   http.Handler
	internalHandler http.Handler
	secureCookies   bool

	streamMu      sync.Mutex // ponytail: one global stream lock; per-path locks only if creation latency matters.
	statsMu       sync.Mutex
	stats         map[string]statsSample
	loginMu       sync.Mutex
	loginAttempts map[string]loginAttempt
	diskOnce      sync.Once
}

type statsSample struct {
	bytes uint64
	at    time.Time
}

func New(cfg Config) (*App, error) {
	if cfg.MaxActiveStreams < 1 {
		cfg.MaxActiveStreams = maxActiveStreams
	}
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "recordings"), 0o750); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}

	db, err := openDatabase(filepath.Join(cfg.DataDir, "app.db"))
	if err != nil {
		return nil, err
	}
	if err := seedAdmin(db); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec(`UPDATE streams SET status = 'stopped', stopped_at = ?, publish_token_hash = '', read_token_hash = '' WHERE status IN ('connecting', 'live')`, time.Now().UTC().Unix()); err != nil {
		db.Close()
		return nil, fmt.Errorf("reset stale streams: %w", err)
	}

	secureCookies := false
	_, certErr := os.Stat(cfg.TLSCertFile)
	_, keyErr := os.Stat(cfg.TLSKeyFile)
	if certErr == nil && keyErr == nil {
		secureCookies = true
	}

	a := &App{
		cfg:           cfg,
		db:            db,
		media:         newMediaManager(cfg),
		secureCookies: secureCookies,
		stats:         make(map[string]statsSample),
		loginAttempts: make(map[string]loginAttempt),
	}
	a.publicHandler = a.withSecurityHeaders(http.HandlerFunc(a.handlePublic))
	a.internalHandler = a.withSecurityHeaders(http.HandlerFunc(a.handleInternal))
	return a, nil
}

func (a *App) Close() {
	if a.media != nil {
		a.media.Close()
	}
	if a.db != nil {
		_ = a.db.Close()
	}
}

func (a *App) StartMedia(ctx context.Context) error {
	a.startDiskMonitor(ctx)
	return a.media.Start(ctx)
}

func (a *App) ServeInternal(ctx context.Context) {
	server := &http.Server{Addr: a.cfg.InternalAddr, Handler: a.internalHandler, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("internal server: %v", err)
	}
}

func (a *App) ServePublic(ctx context.Context) error {
	server := &http.Server{
		Addr:              a.cfg.PublicAddr,
		Handler:           a.publicHandler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	if a.secureCookies {
		log.Printf("VDO Relay listening with HTTPS on %s", a.cfg.PublicAddr)
		return server.ListenAndServeTLS(a.cfg.TLSCertFile, a.cfg.TLSKeyFile)
	}
	log.Printf("VDO Relay listening with HTTP on %s (development only)", a.cfg.PublicAddr)
	return server.ListenAndServe()
}

func randomToken(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func hostOnly(hostport string) string {
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		return host
	}
	return strings.Trim(hostport, "[]")
}

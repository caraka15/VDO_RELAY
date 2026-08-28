package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type mediaManager struct {
	cfg    Config
	client *http.Client

	mu     sync.Mutex
	cmd    *exec.Cmd
	cancel context.CancelFunc
}

func newMediaManager(cfg Config) *mediaManager {
	return &mediaManager{cfg: cfg, client: &http.Client{Timeout: 3 * time.Second}}
}

func (m *mediaManager) Start(parent context.Context) error {
	if _, err := os.Stat(m.cfg.MediaMTXBinary); err != nil {
		return fmt.Errorf("MediaMTX binary %q is not available: %w", m.cfg.MediaMTXBinary, err)
	}
	configPath := filepath.Join(m.cfg.DataDir, "mediamtx.yml")
	if err := os.WriteFile(configPath, []byte(m.configText()), 0o640); err != nil {
		return fmt.Errorf("write MediaMTX config: %w", err)
	}
	ctx, cancel := context.WithCancel(parent)
	m.mu.Lock()
	m.cancel = cancel
	m.mu.Unlock()
	go m.run(ctx, configPath)

	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		if m.healthy(context.Background()) {
			return nil
		}
		select {
		case <-parent.Done():
			return parent.Err()
		case <-deadline.C:
			return fmt.Errorf("MediaMTX control API did not become ready")
		case <-time.After(150 * time.Millisecond):
		}
	}
}

func (m *mediaManager) run(ctx context.Context, configPath string) {
	for {
		if ctx.Err() != nil {
			return
		}
		cmd := exec.CommandContext(ctx, m.cfg.MediaMTXBinary, configPath)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		m.mu.Lock()
		m.cmd = cmd
		m.mu.Unlock()
		err := cmd.Run()
		m.mu.Lock()
		m.cmd = nil
		m.mu.Unlock()
		if ctx.Err() != nil {
			return
		}
		log.Printf("MediaMTX exited: %v; retrying in 2s", err)
		timer := time.NewTimer(2 * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (m *mediaManager) Close() {
	m.mu.Lock()
	if m.cancel != nil {
		m.cancel()
	}
	m.mu.Unlock()
}

func (m *mediaManager) healthy(ctx context.Context) bool {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(m.cfg.ControlURL, "/")+"/v3/paths/list", nil)
	if err != nil {
		return false
	}
	response, err := m.client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode >= 200 && response.StatusCode < 300
}

type pathConfig struct {
	Record                bool   `json:"record"`
	RecordFormat          string `json:"recordFormat,omitempty"`
	RecordPartDuration    string `json:"recordPartDuration,omitempty"`
	RecordSegmentDuration string `json:"recordSegmentDuration,omitempty"`
	RecordDeleteAfter     string `json:"recordDeleteAfter,omitempty"`
	MaxReaders            int    `json:"maxReaders,omitempty"`
}

func (m *mediaManager) addPath(ctx context.Context, path string, record bool) error {
	return m.control(ctx, http.MethodPost, "/v3/config/paths/add/"+url.PathEscape(path), pathConfig{
		Record:     record,
		MaxReaders: 1,
	})
}

func (m *mediaManager) deletePath(ctx context.Context, path string) error {
	err := m.control(ctx, http.MethodDelete, "/v3/config/paths/delete/"+url.PathEscape(path), nil)
	var apiErr mediaControlError
	if errors.As(err, &apiErr) && apiErr.status == http.StatusNotFound {
		return nil
	}
	return err
}

func (m *mediaManager) patchPath(ctx context.Context, path string, record bool) error {
	return m.control(ctx, http.MethodPatch, "/v3/config/paths/patch/"+url.PathEscape(path), pathConfig{Record: record})
}

func (m *mediaManager) ensurePath(ctx context.Context, path string, record bool) error {
	if err := m.patchPath(ctx, path, record); err == nil {
		return nil
	}
	return m.addPath(ctx, path, record)
}

func (m *mediaManager) control(ctx context.Context, method, endpoint string, payload any) error {
	var body *bytes.Reader
	if payload == nil {
		body = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(m.cfg.ControlURL, "/")+endpoint, body)
	if err != nil {
		return err
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := m.client.Do(request)
	if err != nil {
		return fmt.Errorf("MediaMTX control API: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return mediaControlError{status: response.StatusCode, text: response.Status}
	}
	return nil
}

type mediaControlError struct {
	status int
	text   string
}

func (e mediaControlError) Error() string {
	return fmt.Sprintf("MediaMTX control API returned %s", e.text)
}

type mediaPathStats struct {
	Ready         bool
	BytesReceived uint64
	Readers       int
}

func (m *mediaManager) pathStats(ctx context.Context, path string) (mediaPathStats, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(m.cfg.ControlURL, "/")+"/v3/paths/get/"+url.PathEscape(path), nil)
	if err != nil {
		return mediaPathStats{}, err
	}
	response, err := m.client.Do(request)
	if err != nil {
		return mediaPathStats{}, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return mediaPathStats{}, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return mediaPathStats{}, fmt.Errorf("MediaMTX path API returned %s", response.Status)
	}
	var payload struct {
		Ready         bool              `json:"ready"`
		BytesReceived uint64            `json:"bytesReceived"`
		Readers       []json.RawMessage `json:"readers"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return mediaPathStats{}, err
	}
	return mediaPathStats{Ready: payload.Ready, BytesReceived: payload.BytesReceived, Readers: len(payload.Readers)}, nil
}

func (m *mediaManager) configText() string {
	cert := yamlString(m.cfg.TLSCertFile)
	key := yamlString(m.cfg.TLSKeyFile)
	recordPath := yamlString(filepath.ToSlash(filepath.Join(m.cfg.DataDir, "recordings", "%path", "%Y-%m-%d_%H-%M-%S-%f")))
	authURL := yamlString("http://" + m.cfg.InternalAddr + "/internal/media-auth")
	return fmt.Sprintf(`logLevel: info
logDestinations: [stdout]

rtsp: false
rtmp: false
hls: false
webrtc: false

srt: true
srtAddress: :8890

moq: true
moqHTTP2Address: :8892
moqHTTP3Address: :8892
moqServerCert: %s
moqServerKey: %s
moqAllowOrigins: ["*"]

api: true
apiAddress: 127.0.0.1:9997
metrics: true
metricsAddress: 127.0.0.1:9998
playback: true
playbackAddress: 127.0.0.1:9996

authMethod: http
authHTTPAddress: %s
authHTTPExclude:
  - action: api
  - action: metrics
  - action: pprof
  - action: playback

pathDefaults:
  record: false
  maxReaders: 1
  recordPath: %s
  recordFormat: fmp4
  recordPartDuration: 1s
  recordSegmentDuration: 10m
  recordDeleteAfter: 24h

paths:
  all_others:
`, cert, key, authURL, recordPath)
}

func yamlString(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

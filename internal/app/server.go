package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"vdo-relay/web"
)

type apiError struct {
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}

func (a *App) withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()")
		if r.URL.Path == "/player" {
			w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors *; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' https:; frame-src 'self' https:; connect-src 'self' https:")
		} else {
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' https:; frame-src 'self' https:; connect-src 'self' https:")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) handlePublic(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" {
		a.handleHealth(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		a.handleAPI(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/internal/") {
		http.NotFound(w, r)
		return
	}
	a.serveFrontend(w, r)
}

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *App) handleInternal(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/internal/media-auth" || r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	a.handleMediaAuth(w, r)
}

func (a *App) handleAPI(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/api/auth/login":
		a.handleLogin(w, r)
	case r.URL.Path == "/api/auth/logout":
		a.handleLogout(w, r)
	case r.URL.Path == "/api/auth/session":
		a.handleSession(w, r)
	case r.URL.Path == "/api/auth/password":
		a.handlePasswordChange(w, r)
	case r.URL.Path == "/api/streams":
		if r.Method == http.MethodPost {
			a.handleCreateStream(w, r)
		} else if r.Method == http.MethodGet {
			a.handleListStreams(w, r)
		} else {
			http.NotFound(w, r)
		}
	case strings.HasPrefix(r.URL.Path, "/api/streams/"):
		a.handleStreamRoute(w, r)
	case r.URL.Path == "/api/recordings":
		a.handleListRecordings(w, r)
	case strings.HasPrefix(r.URL.Path, "/api/recordings/"):
		a.handleRecordingRoute(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		return
	}
	if len(input.Username) > 64 || len(input.Password) > 256 {
		writeError(w, http.StatusUnauthorized, "invalid credentials", "invalid_credentials")
		return
	}
	ip := clientIP(r)
	if !a.loginAllowed(ip, time.Now()) {
		writeError(w, http.StatusTooManyRequests, "too many failed login attempts; try again later", "login_rate_limited")
		return
	}
	session, user, err := a.login(r.Context(), input.Username, input.Password)
	if err != nil {
		a.noteLoginFailure(ip, time.Now())
		writeError(w, http.StatusUnauthorized, "invalid credentials", "invalid_credentials")
		return
	}
	a.clearLoginFailures(ip)
	a.setSessionCookie(w, session)
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "username": user.Username, "mustChangePassword": user.MustChangePassword})
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	a.clearSession(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) handleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.NotFound(w, r)
		return
	}
	user, ok := a.currentUser(r)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "username": user.Username, "mustChangePassword": user.MustChangePassword})
}

func (a *App) handlePasswordChange(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	user, ok := a.requireUser(w, r)
	if !ok {
		return
	}
	if !sameOrigin(r) {
		writeError(w, http.StatusForbidden, "request origin is not allowed", "origin_denied")
		return
	}
	var input struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		return
	}
	if !validNewPassword(input.NewPassword) {
		writeError(w, http.StatusBadRequest, "new password must contain 10 to 128 characters", "invalid_password")
		return
	}
	var userID int64
	var encoded string
	if err := a.db.QueryRowContext(r.Context(), `SELECT id, password_hash FROM users WHERE username = ?`, user.Username).Scan(&userID, &encoded); err != nil || !verifyPassword(input.CurrentPassword, encoded) {
		writeError(w, http.StatusUnauthorized, "current password is incorrect", "invalid_password")
		return
	}
	newHash, err := hashPassword(input.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save password", "password_update_failed")
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`, newHash, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save password", "password_update_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "mustChangePassword": false})
}

type createStreamRequest struct {
	Codec          string `json:"codec"`
	AudioCodec     string `json:"audioCodec"`
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	FPS            int    `json:"fps"`
	MaxBitrateKbps int    `json:"maxBitrateKbps"`
	PortraitMode   bool   `json:"portraitMode"`
	AudioEnabled   bool   `json:"audioEnabled"`
	Record         bool   `json:"record"`
}

func (input createStreamRequest) validate() error {
	input.Codec = strings.ToLower(input.Codec)
	if input.Codec != "h264" && input.Codec != "h265" {
		return errors.New("codec must be h264 or h265")
	}
	input.AudioCodec = strings.ToLower(input.AudioCodec)
	if input.AudioCodec == "" {
		input.AudioCodec = "opus"
	}
	if input.AudioCodec != "opus" {
		return errors.New("audioCodec must be opus for browser WebRTC")
	}
	if input.Width < 160 || input.Height < 160 || input.Width > 7680 || input.Height > 7680 || input.Width%2 != 0 || input.Height%2 != 0 {
		return errors.New("resolution must be even and between 160 and 7680 pixels")
	}
	if input.FPS < 1 || input.FPS > 120 {
		return errors.New("fps must be between 1 and 120")
	}
	if input.MaxBitrateKbps < 500 || input.MaxBitrateKbps > 12000 {
		return errors.New("max bitrate must be between 500 and 12000 kbps")
	}
	return nil
}

type streamResponse struct {
	ID                 string    `json:"id"`
	Path               string    `json:"path"`
	Status             string    `json:"status"`
	Codec              string    `json:"codec"`
	AudioCodec         string    `json:"audioCodec"`
	Width              int       `json:"width"`
	Height             int       `json:"height"`
	FPS                int       `json:"fps"`
	MaxBitrateKbps     int       `json:"maxBitrateKbps"`
	CurrentBitrateKbps int       `json:"currentBitrateKbps"`
	PortraitMode       bool      `json:"portraitMode"`
	AudioEnabled       bool      `json:"audioEnabled"`
	Record             bool      `json:"record"`
	CreatedAt          time.Time `json:"createdAt"`
	WhipURL            string    `json:"whipUrl,omitempty"`
	PublishToken       string    `json:"publishToken,omitempty"`
	SRTURL             string    `json:"srtUrl,omitempty"`
	PlayerURL          string    `json:"playerUrl,omitempty"`
	Error              string    `json:"error,omitempty"`
}

func (a *App) handleCreateStream(w http.ResponseWriter, r *http.Request) {
	user, ok := a.requireUser(w, r)
	if !ok || user.MustChangePassword {
		if ok {
			writeError(w, http.StatusForbidden, "change the default password first", "password_change_required")
		}
		return
	}
	if !sameOrigin(r) {
		writeError(w, http.StatusForbidden, "request origin is not allowed", "origin_denied")
		return
	}
	var input createStreamRequest
	if err := decodeJSON(w, r, &input); err != nil {
		return
	}
	input.Codec = strings.ToLower(input.Codec)
	if input.AudioCodec == "" {
		input.AudioCodec = "opus"
	}
	input.AudioCodec = strings.ToLower(input.AudioCodec)
	if err := input.validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), "invalid_stream")
		return
	}

	// ponytail: serialize the small create/stop critical section; shard only after profiling contention.
	a.streamMu.Lock()
	defer a.streamMu.Unlock()
	var active int
	if err := a.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM streams WHERE status IN ('ready', 'connecting', 'live')`).Scan(&active); err != nil {
		writeError(w, http.StatusInternalServerError, "could not inspect active streams", "database_error")
		return
	}
	if active >= a.cfg.MaxActiveStreams {
		writeError(w, http.StatusTooManyRequests, "stream limit reached", "stream_limit")
		return
	}
	if !a.media.healthy(r.Context()) {
		writeError(w, http.StatusServiceUnavailable, "media server is not ready", "media_unavailable")
		return
	}
	id, err := randomToken(9)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create stream", "random_error")
		return
	}
	pathName := "vdo-" + id
	publishToken := a.streamToken("publish", id)
	readToken := a.streamToken("read", id)
	if err := a.media.addPath(r.Context(), pathName, input.Record); err != nil {
		writeError(w, http.StatusBadGateway, "could not configure media path", "media_config_error")
		return
	}
	now := time.Now().UTC()
	_, err = a.db.ExecContext(r.Context(), `INSERT INTO streams (id, path, status, codec, audio_codec, width, height, fps, max_bitrate_kbps, current_bitrate_kbps, portrait_mode, audio_enabled, record, publish_token_hash, read_token_hash, created_at) VALUES (?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, pathName, input.Codec, input.AudioCodec, input.Width, input.Height, input.FPS, input.MaxBitrateKbps, input.MaxBitrateKbps, boolInt(input.PortraitMode), boolInt(input.AudioEnabled), boolInt(input.Record), streamTokenHash(publishToken), streamTokenHash(readToken), now.Unix())
	if err != nil {
		_ = a.media.deletePath(context.Background(), pathName)
		writeError(w, http.StatusInternalServerError, "could not save stream", "database_error")
		return
	}
	response := a.responseForStream(streamRecord{ID: id, Path: pathName, Status: "ready", Codec: input.Codec, AudioCodec: input.AudioCodec, Width: input.Width, Height: input.Height, FPS: input.FPS, MaxBitrateKbps: input.MaxBitrateKbps, CurrentBitrateKbps: input.MaxBitrateKbps, PortraitMode: input.PortraitMode, AudioEnabled: input.AudioEnabled, Record: input.Record, CreatedAt: now}, r, publishToken, readToken)
	writeJSON(w, http.StatusCreated, response)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func (a *App) responseForStream(stream streamRecord, r *http.Request, publishToken, readToken string) streamResponse {
	webrtcBase := a.cfg.WebRTCPublicBaseURL
	if webrtcBase == "" {
		webrtcBase = requestScheme(r) + "://" + hostOnly(r.Host) + ":8889"
	}
	mediaPath := strings.TrimRight(webrtcBase, "/") + "/" + url.PathEscape(stream.Path)
	whipURL := mediaPath + "/whip"
	whepURL := mediaPath + "/whep"
	srtHost := a.cfg.SRTPublicHost
	if srtHost == "" {
		srtHost = hostOnly(r.Host)
	}
	srtURL := "srt://" + srtHost + ":8890?streamid=read:" + stream.Path + ":user:" + readToken + "&latency=2000000&pkt_size=1316"
	playerURL := appPlayerURL(a.cfg.PublicOrigin, requestScheme(r)+"://"+r.Host, whepURL, readToken)
	return streamResponse{ID: stream.ID, Path: stream.Path, Status: stream.Status, Codec: stream.Codec, AudioCodec: stream.AudioCodec, Width: stream.Width, Height: stream.Height, FPS: stream.FPS, MaxBitrateKbps: stream.MaxBitrateKbps, CurrentBitrateKbps: stream.CurrentBitrateKbps, PortraitMode: stream.PortraitMode, AudioEnabled: stream.AudioEnabled, Record: stream.Record, CreatedAt: stream.CreatedAt, WhipURL: whipURL, PublishToken: publishToken, SRTURL: srtURL, PlayerURL: playerURL}
}

func appPlayerURL(configuredOrigin, requestOrigin, whepURL, readToken string) string {
	origin := strings.TrimRight(configuredOrigin, "/")
	if origin == "" {
		origin = strings.TrimRight(requestOrigin, "/")
	}
	if origin == "" || whepURL == "" || readToken == "" {
		return ""
	}
	parsed, err := url.Parse(origin + "/player")
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	query := parsed.Query()
	query.Set("url", whepURL)
	query.Set("token", readToken)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func (a *App) publicStreamResponse(stream streamRecord) streamResponse {
	return streamResponse{ID: stream.ID, Path: stream.Path, Status: stream.Status, Codec: stream.Codec, AudioCodec: stream.AudioCodec, Width: stream.Width, Height: stream.Height, FPS: stream.FPS, MaxBitrateKbps: stream.MaxBitrateKbps, CurrentBitrateKbps: stream.CurrentBitrateKbps, PortraitMode: stream.PortraitMode, AudioEnabled: stream.AudioEnabled, Record: stream.Record, CreatedAt: stream.CreatedAt, Error: stream.Error}
}

func (a *App) privateStreamResponse(stream streamRecord, r *http.Request) streamResponse {
	return a.responseForStream(stream, r, a.streamToken("publish", stream.ID), a.streamToken("read", stream.ID))
}

func (a *App) handleListStreams(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireUser(w, r); !ok {
		return
	}
	streams, err := listStreams(r.Context(), a.db)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list streams", "database_error")
		return
	}
	result := make([]streamResponse, 0, len(streams))
	for _, stream := range streams {
		result = append(result, a.publicStreamResponse(stream))
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *App) handleStreamRoute(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/streams/"), "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	if _, ok := a.requireUser(w, r); !ok {
		return
	}
	if len(parts) == 2 && parts[1] == "stats" && r.Method == http.MethodGet {
		a.handleStreamStats(w, r, parts[0])
		return
	}
	if len(parts) == 2 && parts[1] == "stop" && r.Method == http.MethodPost {
		a.handleStopStream(w, r, parts[0])
		return
	}
	if len(parts) == 1 && r.Method == http.MethodDelete {
		a.handleDeleteStream(w, r, parts[0])
		return
	}
	if len(parts) == 1 && r.Method == http.MethodPatch {
		a.handleUpdateStream(w, r, parts[0])
		return
	}
	if len(parts) == 1 && r.Method == http.MethodGet {
		stream, err := getStream(r.Context(), a.db, parts[0])
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "stream not found", "not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not load stream", "database_error")
			return
		}
		if err := a.ensureStreamTokens(r.Context(), &stream); err != nil {
			writeError(w, http.StatusInternalServerError, "could not restore stream token", "database_error")
			return
		}
		writeJSON(w, http.StatusOK, a.privateStreamResponse(stream, r))
		return
	}
	http.NotFound(w, r)
}

func (a *App) handleUpdateStream(w http.ResponseWriter, r *http.Request, id string) {
	if !sameOrigin(r) {
		writeError(w, http.StatusForbidden, "request origin is not allowed", "origin_denied")
		return
	}
	var input createStreamRequest
	if err := decodeJSON(w, r, &input); err != nil {
		return
	}
	input.Codec = strings.ToLower(input.Codec)
	if input.AudioCodec == "" {
		input.AudioCodec = "opus"
	}
	input.AudioCodec = strings.ToLower(input.AudioCodec)
	if err := input.validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), "invalid_stream")
		return
	}
	a.streamMu.Lock()
	defer a.streamMu.Unlock()
	stream, err := getStream(r.Context(), a.db, id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "stream not found", "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load stream", "database_error")
		return
	}
	if err := a.ensureStreamTokens(r.Context(), &stream); err != nil {
		writeError(w, http.StatusInternalServerError, "could not restore stream token", "database_error")
		return
	}
	if err := a.media.ensurePath(r.Context(), stream.Path, input.Record); err != nil {
		writeError(w, http.StatusBadGateway, "could not update media path", "media_config_error")
		return
	}
	_, err = a.db.ExecContext(r.Context(), `UPDATE streams SET status = 'ready', stopped_at = NULL, codec = ?, audio_codec = ?, width = ?, height = ?, fps = ?, max_bitrate_kbps = ?, current_bitrate_kbps = ?, portrait_mode = ?, audio_enabled = ?, record = ?, error = '' WHERE id = ?`, input.Codec, input.AudioCodec, input.Width, input.Height, input.FPS, input.MaxBitrateKbps, input.MaxBitrateKbps, boolInt(input.PortraitMode), boolInt(input.AudioEnabled), boolInt(input.Record), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not update stream", "database_error")
		return
	}
	stream.Status = "ready"
	stream.Codec = input.Codec
	stream.AudioCodec = input.AudioCodec
	stream.Width = input.Width
	stream.Height = input.Height
	stream.FPS = input.FPS
	stream.MaxBitrateKbps = input.MaxBitrateKbps
	stream.CurrentBitrateKbps = input.MaxBitrateKbps
	stream.PortraitMode = input.PortraitMode
	stream.AudioEnabled = input.AudioEnabled
	stream.Record = input.Record
	stream.StoppedAt = nil
	stream.Error = ""
	writeJSON(w, http.StatusOK, a.privateStreamResponse(stream, r))
}

func (a *App) handleStopStream(w http.ResponseWriter, r *http.Request, id string) {
	if !sameOrigin(r) {
		writeError(w, http.StatusForbidden, "request origin is not allowed", "origin_denied")
		return
	}
	a.streamMu.Lock()
	defer a.streamMu.Unlock()
	stream, err := getStream(r.Context(), a.db, id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "stream not found", "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load stream", "database_error")
		return
	}
	if stream.Status == "stopped" || stream.Status == "failed" {
		writeJSON(w, http.StatusOK, a.publicStreamResponse(stream))
		return
	}
	now := time.Now().UTC()
	_, err = a.db.Exec(`UPDATE streams SET status = 'stopped', stopped_at = ? WHERE id = ?`, now.Unix(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not stop stream", "database_error")
		return
	}
	stream.Status = "stopped"
	stream.StoppedAt = &now
	mediaErr := a.media.deletePath(r.Context(), stream.Path)
	if mediaErr != nil {
		writeError(w, http.StatusBadGateway, "stream stopped, but media path cleanup failed", "media_config_error")
		return
	}
	writeJSON(w, http.StatusOK, a.publicStreamResponse(stream))
}

func (a *App) handleDeleteStream(w http.ResponseWriter, r *http.Request, id string) {
	if !sameOrigin(r) {
		writeError(w, http.StatusForbidden, "request origin is not allowed", "origin_denied")
		return
	}
	a.streamMu.Lock()
	defer a.streamMu.Unlock()
	stream, err := getStream(r.Context(), a.db, id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "stream not found", "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load stream", "database_error")
		return
	}
	if err := a.media.deletePath(r.Context(), stream.Path); err != nil {
		writeError(w, http.StatusBadGateway, "could not remove media path; stream was not deleted", "media_config_error")
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `DELETE FROM streams WHERE id = ?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete stream", "database_error")
		return
	}
	a.statsMu.Lock()
	delete(a.stats, id)
	a.statsMu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) handleStreamStats(w http.ResponseWriter, r *http.Request, id string) {
	stream, err := getStream(r.Context(), a.db, id)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "stream not found", "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load stream", "database_error")
		return
	}
	mediaStats, mediaErr := a.media.pathStats(r.Context(), stream.Path)
	status := stream.Status
	if mediaErr == nil && openStreamStatus(status) {
		nextStatus := "ready"
		if mediaStats.Ready {
			nextStatus = "live"
		}
		if nextStatus != status {
			status = nextStatus
			_, _ = a.db.ExecContext(r.Context(), `UPDATE streams SET status = ? WHERE id = ?`, status, id)
		}
	}
	var received *int
	if mediaErr == nil {
		now := time.Now()
		a.statsMu.Lock()
		previous, exists := a.stats[id]
		a.stats[id] = statsSample{bytes: mediaStats.InboundBytes, at: now}
		a.statsMu.Unlock()
		if exists && mediaStats.InboundBytes >= previous.bytes && now.After(previous.at) {
			value := int(float64(mediaStats.InboundBytes-previous.bytes) * 8 / now.Sub(previous.at).Seconds() / 1000)
			received = &value
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":                  stream.ID,
		"status":              status,
		"maxBitrateKbps":      stream.MaxBitrateKbps,
		"currentBitrateKbps":  stream.CurrentBitrateKbps,
		"receivedBitrateKbps": received,
		"codec":               stream.Codec,
		"width":               stream.Width,
		"height":              stream.Height,
		"fps":                 stream.FPS,
		"srtReaders": func() int {
			if mediaErr == nil {
				return mediaStats.Readers
			}
			return 0
		}(),
		"recording":      stream.Record && mediaErr == nil && mediaStats.Ready,
		"mediaAvailable": mediaErr == nil,
	})
}

func (a *App) handleListRecordings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.NotFound(w, r)
		return
	}
	if _, ok := a.requireUser(w, r); !ok {
		return
	}
	items, err := a.listRecordings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list recordings", "recording_error")
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (a *App) handleRecordingRoute(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requireUser(w, r); !ok {
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/recordings/"), "/"), "/")
	if len(parts) == 0 || parts[0] == "" || len(parts) > 2 {
		http.NotFound(w, r)
		return
	}
	action := ""
	if len(parts) == 2 {
		action = parts[1]
	}
	if action == "" && r.Method == http.MethodDelete {
		action = "delete"
	}
	file, err := a.recordingFile(parts[0])
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), "invalid_recording")
		return
	}
	switch {
	case action == "download" && r.Method == http.MethodGet:
		name := path.Base(file)
		w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(name, `"`, "")+`"`)
		http.ServeFile(w, r, file)
	case action == "delete" && r.Method == http.MethodDelete:
		if !sameOrigin(r) {
			writeError(w, http.StatusForbidden, "request origin is not allowed", "origin_denied")
			return
		}
		if err := os.Remove(file); err != nil {
			if os.IsNotExist(err) {
				writeError(w, http.StatusNotFound, "recording not found", "not_found")
			} else {
				writeError(w, http.StatusInternalServerError, "could not delete recording", "recording_error")
			}
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
}

type mediaAuthRequest struct {
	User     string `json:"user"`
	Password string `json:"password"`
	Token    string `json:"token"`
	Action   string `json:"action"`
	Path     string `json:"path"`
	Protocol string `json:"protocol"`
	Query    string `json:"query"`
}

func (a *App) handleMediaAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil && host != "127.0.0.1" && host != "::1" {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var input mediaAuthRequest
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if input.Path == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if input.Protocol != "" && input.Protocol != "webrtc" && input.Protocol != "srt" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if input.Action != "publish" && input.Action != "read" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	token := strings.TrimSpace(input.Token)
	if token == "" {
		token = strings.TrimSpace(input.Password)
	}
	if strings.HasPrefix(token, "Bearer ") {
		token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	}
	if input.Query != "" {
		if values, err := url.ParseQuery(input.Query); err == nil && token == "" {
			token = values.Get("token")
		}
	}
	stream, err := getStreamByPath(r.Context(), a.db, input.Path)
	if err != nil || !openStreamStatus(stream.Status) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if input.Action == "publish" && !tokenMatches(stream.PublishTokenHash, token) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if input.Action == "read" && !tokenMatches(stream.ReadTokenHash, token) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func getStreamByPath(ctx context.Context, db *sql.DB, pathName string) (streamRecord, error) {
	return scanStream(db.QueryRowContext(ctx, `SELECT `+streamColumns+` FROM streams WHERE path = ?`, pathName))
}

func (a *App) requireUser(w http.ResponseWriter, r *http.Request) (authenticatedUser, bool) {
	user, ok := a.currentUser(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required", "unauthorized")
	}
	return user, ok
}

func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || !strings.EqualFold(parsed.Host, r.Host) {
		return false
	}
	return strings.EqualFold(parsed.Scheme, requestScheme(r))
}

func requestScheme(r *http.Request) string {
	forwardedProto := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
	if r.TLS != nil || strings.EqualFold(forwardedProto, "https") {
		return "https"
	}
	return "http"
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body", "invalid_json")
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message, code string) {
	writeJSON(w, status, apiError{Error: message, Code: code})
}

func (a *App) serveFrontend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	requested := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if requested == "" || requested == "." {
		requested = "index.html"
	}
	if strings.Contains(requested, "..") {
		http.NotFound(w, r)
		return
	}
	assetPath := "dist/" + requested
	data, err := fsReadFile(assetPath)
	if err != nil {
		// Only extensionless paths are client-side routes. Returning index.html
		// for a missing JS/CSS file makes stale cached HTML look like a bundle.
		if path.Ext(requested) != "" {
			http.NotFound(w, r)
			return
		}
		requested = "index.html"
		assetPath = "dist/index.html"
		data, err = fsReadFile(assetPath)
	}
	if err != nil {
		http.Error(w, "frontend unavailable", http.StatusInternalServerError)
		return
	}
	contentType := mime.TypeByExtension(path.Ext(requested))
	if contentType == "" {
		contentType = "text/html; charset=utf-8"
	}
	w.Header().Set("Content-Type", contentType)
	if strings.HasSuffix(requested, ".js") || strings.HasSuffix(requested, ".css") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if requested == "index.html" {
		w.Header().Set("Cache-Control", "no-store, max-age=0")
	}
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(data)
}

func fsReadFile(name string) ([]byte, error) {
	return fs.ReadFile(web.Files, name)
}

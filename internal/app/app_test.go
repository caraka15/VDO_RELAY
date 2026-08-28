package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	encoded, err := hashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !verifyPassword("correct horse battery staple", encoded) {
		t.Fatal("hashed password did not verify")
	}
	if verifyPassword("wrong password", encoded) {
		t.Fatal("wrong password verified")
	}
}

func TestStreamTokenHash(t *testing.T) {
	if !tokenMatches(streamTokenHash("read-secret"), "read-secret") {
		t.Fatal("token should match its hash")
	}
	if tokenMatches(streamTokenHash("read-secret"), "other-secret") {
		t.Fatal("different token matched")
	}
	if tokenMatches("", "read-secret") {
		t.Fatal("empty stored hash matched")
	}
}

func TestMediaPlayerURL(t *testing.T) {
	player := appPlayerURL("https://app.example.com", "", "https://media.example.com/vdo-stream/whep", "read-secret")
	for _, expected := range []string{
		"https://app.example.com/player",
		"url=https%3A%2F%2Fmedia.example.com%2Fvdo-stream%2Fwhep",
		"token=read-secret",
	} {
		if !strings.Contains(player, expected) {
			t.Fatalf("player URL missing %q: %s", expected, player)
		}
	}
}

func TestStreamResponseUsesWhipAndWhepPlayer(t *testing.T) {
	application := &App{cfg: Config{
		PublicOrigin:        "https://example.com",
		WebRTCPublicBaseURL: "https://media.example.com",
		SRTPublicHost:       "media.example.com",
	}}
	request := httptest.NewRequest(http.MethodGet, "https://example.com/api/streams/stream-1", nil)
	response := application.responseForStream(streamRecord{ID: "stream-1", Path: "vdo-stream", Status: "ready", Codec: "h264", AudioCodec: "opus", Width: 1280, Height: 720, FPS: 30, MaxBitrateKbps: 4000, CurrentBitrateKbps: 4000}, request, "publish-secret", "read-secret")
	if response.WhipURL != "https://media.example.com/vdo-stream/whip" {
		t.Fatalf("unexpected WHIP URL: %s", response.WhipURL)
	}
	if !strings.Contains(response.PlayerURL, "https://example.com/player?") || !strings.Contains(response.PlayerURL, "token=read-secret") {
		t.Fatalf("unexpected player URL: %s", response.PlayerURL)
	}
	if strings.Contains(response.WhipURL, "8892") || strings.Contains(response.PlayerURL, "fingerprint") {
		t.Fatal("response still contains the old MoQ/fingerprint flow")
	}
}

func TestMediaOriginsAllowBrowserAliases(t *testing.T) {
	config := newMediaManager(Config{
		PublicOrigin:        "https://app.example.com",
		WebRTCPublicBaseURL: "https://media.example.com",
	}).configText()
	if !strings.Contains(config, `webrtcAllowOrigins: ["*"]`) {
		t.Fatal("WebRTC must accept browser aliases; media authentication still protects each path")
	}
	if !strings.Contains(config, "moq: false") {
		t.Fatal("MoQ must be explicitly disabled because MediaMTX enables it by default")
	}
	if !strings.Contains(config, "webrtcAddress: :8889") || !strings.Contains(config, "webrtcLocalUDPAddress: :8189") {
		t.Fatal("WebRTC handshake and ICE listeners are not configured")
	}
}

func TestReusableStreamTokens(t *testing.T) {
	dataDir := t.TempDir()
	application, err := New(Config{DataDir: dataDir, MaxActiveStreams: 8})
	if err != nil {
		t.Fatal(err)
	}
	publish := application.streamToken("publish", "stream-1")
	if publish != application.streamToken("publish", "stream-1") {
		t.Fatal("stream token is not stable")
	}
	if publish == application.streamToken("read", "stream-1") || publish == application.streamToken("publish", "stream-2") {
		t.Fatal("stream tokens are not scoped by purpose and stream")
	}
	application.Close()
	restarted, err := New(Config{DataDir: dataDir, MaxActiveStreams: 8})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if publish != restarted.streamToken("publish", "stream-1") {
		t.Fatal("stream token changed after backend restart")
	}
}

func TestReusableStreamLifecycle(t *testing.T) {
	deleteCalls := 0
	mediaAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			deleteCalls++
			if deleteCalls == 3 {
				w.WriteHeader(http.StatusNotFound)
				return
			}
		}
		if r.Method != http.MethodDelete && r.Method != http.MethodPatch {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer mediaAPI.Close()

	application, err := New(Config{DataDir: t.TempDir(), ControlURL: mediaAPI.URL, MaxActiveStreams: 8})
	if err != nil {
		t.Fatal(err)
	}
	defer application.Close()

	streamID := "reusable-lifecycle"
	pathName := "vdo-reusable-lifecycle"
	publishToken := application.streamToken("publish", streamID)
	readToken := application.streamToken("read", streamID)
	_, err = application.db.Exec(`INSERT INTO streams (id, path, status, codec, audio_codec, width, height, fps, max_bitrate_kbps, current_bitrate_kbps, portrait_mode, audio_enabled, record, publish_token_hash, read_token_hash, created_at) VALUES (?, ?, 'ready', 'h264', 'opus', 1280, 720, 30, 4000, 4000, 0, 1, 0, ?, ?, ?)`, streamID, pathName, streamTokenHash(publishToken), streamTokenHash(readToken), time.Now().UTC().Unix())
	if err != nil {
		t.Fatal(err)
	}

	stop := httptest.NewRecorder()
	application.handleStopStream(stop, httptest.NewRequest(http.MethodPost, "/api/streams/"+streamID+"/stop", nil), streamID)
	if stop.Code != http.StatusOK {
		t.Fatalf("stop status = %d, body = %s", stop.Code, stop.Body.String())
	}
	var publishHash, readHash string
	if err := application.db.QueryRow(`SELECT publish_token_hash, read_token_hash FROM streams WHERE id = ?`, streamID).Scan(&publishHash, &readHash); err != nil {
		t.Fatal(err)
	}
	if !tokenMatches(publishHash, publishToken) || !tokenMatches(readHash, readToken) {
		t.Fatal("stopping a stream revoked its reusable tokens")
	}
	if deleteCalls != 1 {
		t.Fatalf("stop media delete calls = %d, want 1", deleteCalls)
	}

	session, err := application.createSession(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	get := httptest.NewRequest(http.MethodGet, "/api/streams/"+streamID, nil)
	get.AddCookie(&http.Cookie{Name: sessionCookieName, Value: session})
	getResult := httptest.NewRecorder()
	application.publicHandler.ServeHTTP(getResult, get)
	if getResult.Code != http.StatusOK {
		t.Fatalf("reopen status = %d, body = %s", getResult.Code, getResult.Body.String())
	}
	var reopened streamResponse
	if err := json.Unmarshal(getResult.Body.Bytes(), &reopened); err != nil {
		t.Fatal(err)
	}
	if reopened.PublishToken != publishToken || reopened.SRTURL == "" {
		t.Fatalf("stopped stream did not return reusable credentials: %+v", reopened)
	}

	update := httptest.NewRequest(http.MethodPatch, "/api/streams/"+streamID, strings.NewReader(`{"codec":"h264","audioCodec":"opus","width":1280,"height":720,"fps":30,"maxBitrateKbps":4000,"portraitMode":false,"audioEnabled":true,"record":false}`))
	updateResult := httptest.NewRecorder()
	application.handleUpdateStream(updateResult, update, streamID)
	if updateResult.Code != http.StatusOK {
		t.Fatalf("reuse update status = %d, body = %s", updateResult.Code, updateResult.Body.String())
	}

	secondStop := httptest.NewRecorder()
	application.handleStopStream(secondStop, httptest.NewRequest(http.MethodPost, "/api/streams/"+streamID+"/stop", nil), streamID)
	if secondStop.Code != http.StatusOK || deleteCalls != 2 {
		t.Fatalf("second stop status = %d, media delete calls = %d", secondStop.Code, deleteCalls)
	}

	remove := httptest.NewRecorder()
	application.handleDeleteStream(remove, httptest.NewRequest(http.MethodDelete, "/api/streams/"+streamID, nil), streamID)
	if remove.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s", remove.Code, remove.Body.String())
	}
	if _, err := getStream(context.Background(), application.db, streamID); err != sql.ErrNoRows {
		t.Fatalf("deleted stream lookup error = %v, want sql.ErrNoRows", err)
	}
	if deleteCalls != 3 {
		t.Fatalf("delete path calls = %d, want stop, stop, and idempotent delete", deleteCalls)
	}
}

func TestLegacyStreamMigrationAddsAudioCodec(t *testing.T) {
	dataDir := t.TempDir()
	legacy, err := sql.Open("sqlite", filepath.Join(dataDir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = legacy.Exec(`CREATE TABLE streams (
		id TEXT PRIMARY KEY,
		path TEXT NOT NULL UNIQUE,
		status TEXT NOT NULL,
		codec TEXT NOT NULL,
		width INTEGER NOT NULL,
		height INTEGER NOT NULL,
		fps INTEGER NOT NULL,
		max_bitrate_kbps INTEGER NOT NULL,
		current_bitrate_kbps INTEGER NOT NULL,
		portrait_mode INTEGER NOT NULL,
		audio_enabled INTEGER NOT NULL,
		record INTEGER NOT NULL,
		publish_token_hash TEXT NOT NULL,
		read_token_hash TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		stopped_at INTEGER,
		error TEXT NOT NULL DEFAULT ''
	)`)
	if err != nil {
		legacy.Close()
		t.Fatal(err)
	}
	_, err = legacy.Exec(`INSERT INTO streams (id, path, status, codec, width, height, fps, max_bitrate_kbps, current_bitrate_kbps, portrait_mode, audio_enabled, record, publish_token_hash, read_token_hash, created_at) VALUES ('legacy', 'vdo-legacy', 'stopped', 'h264', 1280, 720, 30, 4000, 4000, 0, 0, 0, '', '', 1)`)
	if err != nil {
		legacy.Close()
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	application, err := New(Config{DataDir: dataDir, MaxActiveStreams: 8})
	if err != nil {
		t.Fatal(err)
	}
	defer application.Close()
	var codec string
	if err := application.db.QueryRow(`SELECT audio_codec FROM streams LIMIT 1`).Scan(&codec); err != nil {
		t.Fatal(err)
	}
	if codec != "opus" {
		t.Fatalf("legacy audio codec = %q, want opus", codec)
	}
}

func TestStreamValidation(t *testing.T) {
	valid := createStreamRequest{Codec: "h265", Width: 1920, Height: 1080, FPS: 60, MaxBitrateKbps: 4000}
	if err := valid.validate(); err != nil {
		t.Fatalf("valid profile rejected: %v", err)
	}
	for name, input := range map[string]createStreamRequest{
		"codec":      {Codec: "vp9", Width: 1920, Height: 1080, FPS: 30, MaxBitrateKbps: 4000},
		"resolution": {Codec: "h264", Width: 1280, Height: 800, FPS: 30, MaxBitrateKbps: 4000},
		"fps":        {Codec: "h264", Width: 1280, Height: 720, FPS: 25, MaxBitrateKbps: 4000},
		"bitrate":    {Codec: "h264", Width: 1280, Height: 720, FPS: 30, MaxBitrateKbps: 499},
	} {
		if err := input.validate(); err == nil {
			t.Fatalf("%s profile unexpectedly accepted", name)
		}
	}
}

func TestSameOriginBehindTLSProxy(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "https://app.example.com/api/streams", nil)
	request.Host = "app.example.com"
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("X-Forwarded-Proto", "https")
	if !sameOrigin(request) {
		t.Fatal("HTTPS same-origin request behind proxy was rejected")
	}

	request.Header.Set("Origin", "http://app.example.com")
	if sameOrigin(request) {
		t.Fatal("HTTP origin should not match HTTPS application origin")
	}
}

func TestHealthz(t *testing.T) {
	application, err := New(Config{DataDir: t.TempDir(), MaxActiveStreams: 8})
	if err != nil {
		t.Fatal(err)
	}
	defer application.Close()

	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	recorder := httptest.NewRecorder()
	application.publicHandler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"status":"ok"`) {
		t.Fatalf("unexpected health response: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestFrontendCacheAndMissingAssetHandling(t *testing.T) {
	application, err := New(Config{DataDir: t.TempDir(), MaxActiveStreams: 8})
	if err != nil {
		t.Fatal(err)
	}
	defer application.Close()

	index := httptest.NewRecorder()
	application.publicHandler.ServeHTTP(index, httptest.NewRequest(http.MethodGet, "/", nil))
	if index.Code != http.StatusOK || index.Header().Get("Cache-Control") != "no-store, max-age=0" {
		t.Fatalf("index cache policy = %d %q", index.Code, index.Header().Get("Cache-Control"))
	}

	missing := httptest.NewRecorder()
	application.publicHandler.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/assets/old-bundle.js", nil))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing bundle status = %d, want 404", missing.Code)
	}

	api := httptest.NewRecorder()
	application.publicHandler.ServeHTTP(api, httptest.NewRequest(http.MethodGet, "/api/auth/session", nil))
	if api.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("API cache policy = %q", api.Header().Get("Cache-Control"))
	}
}

func TestEmptyRecordingsAreAnArray(t *testing.T) {
	application, err := New(Config{DataDir: t.TempDir(), MaxActiveStreams: 8})
	if err != nil {
		t.Fatal(err)
	}
	defer application.Close()

	items, err := application.listRecordings()
	if err != nil {
		t.Fatal(err)
	}
	if items == nil {
		t.Fatal("empty recordings must be a non-nil slice so JSON encodes as []")
	}
}

func TestDefaultLoginCreatesSession(t *testing.T) {
	application, err := New(Config{DataDir: t.TempDir(), MaxActiveStreams: 8, InternalAddr: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	defer application.Close()

	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"admin","password":"admin"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	application.publicHandler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("login status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Authenticated      bool `json:"authenticated"`
		MustChangePassword bool `json:"mustChangePassword"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.Authenticated || !response.MustChangePassword {
		t.Fatalf("unexpected login response: %+v", response)
	}
	if len(recorder.Result().Cookies()) != 1 || recorder.Result().Cookies()[0].HttpOnly != true {
		t.Fatal("login did not set an HttpOnly session cookie")
	}

	change := httptest.NewRequest(http.MethodPost, "/api/auth/password", strings.NewReader(`{"currentPassword":"admin","newPassword":"a much safer password"}`))
	change.AddCookie(recorder.Result().Cookies()[0])
	change.Header.Set("Content-Type", "application/json")
	changed := httptest.NewRecorder()
	application.publicHandler.ServeHTTP(changed, change)
	if changed.Code != http.StatusOK {
		t.Fatalf("password change status = %d, body = %s", changed.Code, changed.Body.String())
	}
	if _, _, err := application.login(change.Context(), "admin", "admin"); err == nil {
		t.Fatal("old password still works after password change")
	}
}

func TestMediaAuthAcceptsMediaMTXPayload(t *testing.T) {
	application, err := New(Config{DataDir: t.TempDir(), MaxActiveStreams: 8})
	if err != nil {
		t.Fatal(err)
	}
	defer application.Close()

	pathName := "vdo-auth-test"
	secret := "publish-secret"
	_, err = application.db.Exec(`INSERT INTO streams (id, path, status, codec, width, height, fps, max_bitrate_kbps, current_bitrate_kbps, portrait_mode, audio_enabled, record, publish_token_hash, read_token_hash, created_at) VALUES (?, ?, 'connecting', 'h264', 1280, 720, 30, 4000, 4000, 0, 0, 0, ?, ?, ?)`, "stream-auth", pathName, streamTokenHash(secret), streamTokenHash("read-secret"), time.Now().UTC().Unix())
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(map[string]any{
		"user": "", "password": "", "token": secret, "action": "publish", "path": pathName,
		"protocol": "webrtc", "query": "", "ip": "127.0.0.1", "id": "connection-id", "userAgent": "Chrome",
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/internal/media-auth", strings.NewReader(string(body)))
	request.RemoteAddr = "127.0.0.1:9999"
	recorder := httptest.NewRecorder()
	application.internalHandler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("valid MediaMTX auth status = %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "/internal/media-auth", strings.NewReader(`{"action":"publish","path":"vdo-auth-test","protocol":"webrtc","token":"wrong"}`))
	request.RemoteAddr = "127.0.0.1:9999"
	recorder = httptest.NewRecorder()
	application.internalHandler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("invalid MediaMTX auth status = %d", recorder.Code)
	}
}

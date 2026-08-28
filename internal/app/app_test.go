package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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
	player := moqPlayerURL("https://media.example.com:8892", "vdo-stream", "read-secret")
	for _, expected := range []string{
		"https://media.example.com:8892/vdo-stream",
		"token=read-secret",
		"autoplay=true",
		"muted=true",
		"controls=true",
		"playsInline=true",
	} {
		if !strings.Contains(player, expected) {
			t.Fatalf("player URL missing %q: %s", expected, player)
		}
	}
}

func TestMediaOriginsAreExplicit(t *testing.T) {
	config := newMediaManager(Config{
		PublicOrigin:     "https://app.example.com",
		MoQPublicBaseURL: "https://media.example.com:8892",
	}).configText()
	if strings.Contains(config, `moqAllowOrigins: ["*"]`) {
		t.Fatal("MoQ origins must not use a wildcard")
	}
	for _, expected := range []string{"https://app.example.com", "https://media.example.com:8892"} {
		if !strings.Contains(config, expected) {
			t.Fatalf("MediaMTX config missing explicit origin %q", expected)
		}
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
		"protocol": "moq", "query": "", "ip": "127.0.0.1", "id": "connection-id", "userAgent": "Chrome",
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

	request = httptest.NewRequest(http.MethodPost, "/internal/media-auth", strings.NewReader(`{"action":"publish","path":"vdo-auth-test","protocol":"moq","token":"wrong"}`))
	request.RemoteAddr = "127.0.0.1:9999"
	recorder = httptest.NewRecorder()
	application.internalHandler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("invalid MediaMTX auth status = %d", recorder.Code)
	}
}

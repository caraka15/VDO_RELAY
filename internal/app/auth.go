package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net"
	"net/http"
	"strings"
	"time"
)

const sessionCookieName = "vdo_session"

type authenticatedUser struct {
	Username           string
	MustChangePassword bool
}

type loginAttempt struct {
	failures    int
	lastFailure time.Time
	blockedTill time.Time
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func (a *App) loginAllowed(ip string, now time.Time) bool {
	a.loginMu.Lock()
	defer a.loginMu.Unlock()
	attempt, ok := a.loginAttempts[ip]
	if !ok {
		return true
	}
	return !now.Before(attempt.blockedTill)
}

func (a *App) noteLoginFailure(ip string, now time.Time) {
	a.loginMu.Lock()
	defer a.loginMu.Unlock()
	attempt := a.loginAttempts[ip]
	if now.Sub(attempt.lastFailure) > 15*time.Minute {
		attempt.failures = 0
	}
	attempt.failures++
	attempt.lastFailure = now
	if attempt.failures >= 5 {
		attempt.blockedTill = now.Add(1 * time.Minute)
	}
	a.loginAttempts[ip] = attempt
}

func (a *App) clearLoginFailures(ip string) {
	a.loginMu.Lock()
	delete(a.loginAttempts, ip)
	a.loginMu.Unlock()
}

func sessionHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func (a *App) currentUser(r *http.Request) (authenticatedUser, bool) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return authenticatedUser{}, false
	}
	var user authenticatedUser
	var mustChange int
	err = a.db.QueryRowContext(r.Context(), `
		SELECT u.username, u.must_change_password
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.id_hash = ? AND s.expires_at > ?`, sessionHash(cookie.Value), time.Now().UTC().Unix()).Scan(&user.Username, &mustChange)
	if err != nil {
		return authenticatedUser{}, false
	}
	user.MustChangePassword = mustChange != 0
	return user, true
}

func (a *App) createSession(ctx context.Context, userID int64) (string, error) {
	value, err := randomToken(32)
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	_, err = a.db.ExecContext(ctx, `INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`, sessionHash(value), userID, now.Add(24*time.Hour).Unix(), now.Unix())
	return value, err
}

func (a *App) setSessionCookie(w http.ResponseWriter, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   24 * 60 * 60,
		HttpOnly: true,
		Secure:   a.secureCookies,
		SameSite: http.SameSiteStrictMode,
	})
}

func (a *App) clearSession(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookieName); err == nil {
		_, _ = a.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE id_hash = ?`, sessionHash(cookie.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: a.secureCookies, SameSite: http.SameSiteStrictMode})
}

func (a *App) login(ctx context.Context, username, password string) (string, authenticatedUser, error) {
	var id int64
	var encoded string
	var mustChange int
	err := a.db.QueryRowContext(ctx, `SELECT id, password_hash, must_change_password FROM users WHERE username = ?`, username).Scan(&id, &encoded, &mustChange)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", authenticatedUser{}, sql.ErrNoRows
		}
		return "", authenticatedUser{}, err
	}
	if !verifyPassword(password, encoded) {
		return "", authenticatedUser{}, sql.ErrNoRows
	}
	session, err := a.createSession(ctx, id)
	if err != nil {
		return "", authenticatedUser{}, err
	}
	return session, authenticatedUser{Username: username, MustChangePassword: mustChange != 0}, nil
}

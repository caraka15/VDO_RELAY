package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

func openDatabase(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	for _, statement := range []string{
		`PRAGMA journal_mode = WAL`,
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			must_change_password INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			id_hash TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)`,
		`CREATE TABLE IF NOT EXISTS streams (
			id TEXT PRIMARY KEY,
			path TEXT NOT NULL UNIQUE,
			status TEXT NOT NULL,
			codec TEXT NOT NULL,
			audio_codec TEXT NOT NULL DEFAULT 'opus',
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
		)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			db.Close()
			return nil, fmt.Errorf("migrate sqlite: %w", err)
		}
	}
	if err := ensureColumn(db, "streams", "audio_codec", "TEXT NOT NULL DEFAULT 'opus'"); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate streams audio codec: %w", err)
	}
	return db, nil
}

func ensureColumn(db *sql.DB, table, column, definition string) error {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var (
		cid          int
		name         string
		columnType   string
		notNull      int
		defaultValue sql.NullString
		primaryKey   int
	)
	for rows.Next() {
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + definition)
	return err
}

func seedAdmin(db *sql.DB) error {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return fmt.Errorf("count users: %w", err)
	}
	if count != 0 {
		return nil
	}
	hash, err := hashPassword(defaultPassword)
	if err != nil {
		return fmt.Errorf("hash default password: %w", err)
	}
	_, err = db.Exec(`INSERT INTO users (username, password_hash, must_change_password, created_at) VALUES (?, ?, 1, ?)`, defaultUser, hash, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("seed admin: %w", err)
	}
	return nil
}

type streamRecord struct {
	ID                 string
	Path               string
	Status             string
	Codec              string
	AudioCodec         string
	Width              int
	Height             int
	FPS                int
	MaxBitrateKbps     int
	CurrentBitrateKbps int
	PortraitMode       bool
	AudioEnabled       bool
	Record             bool
	PublishTokenHash   string
	ReadTokenHash      string
	CreatedAt          time.Time
	StoppedAt          *time.Time
	Error              string
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanStream(row rowScanner) (streamRecord, error) {
	var stream streamRecord
	var portrait, audio, record int
	var createdAt int64
	var stoppedAt sql.NullInt64
	if err := row.Scan(
		&stream.ID, &stream.Path, &stream.Status, &stream.Codec, &stream.AudioCodec, &stream.Width, &stream.Height,
		&stream.FPS, &stream.MaxBitrateKbps, &stream.CurrentBitrateKbps, &portrait, &audio, &record,
		&stream.PublishTokenHash, &stream.ReadTokenHash, &createdAt, &stoppedAt, &stream.Error,
	); err != nil {
		return stream, err
	}
	stream.PortraitMode = portrait != 0
	stream.AudioEnabled = audio != 0
	stream.Record = record != 0
	stream.CreatedAt = time.Unix(createdAt, 0).UTC()
	if stoppedAt.Valid {
		value := time.Unix(stoppedAt.Int64, 0).UTC()
		stream.StoppedAt = &value
	}
	return stream, nil
}

const streamColumns = `id, path, status, codec, audio_codec, width, height, fps, max_bitrate_kbps, current_bitrate_kbps, portrait_mode, audio_enabled, record, publish_token_hash, read_token_hash, created_at, stopped_at, error`

func getStream(ctx context.Context, db *sql.DB, id string) (streamRecord, error) {
	return scanStream(db.QueryRowContext(ctx, `SELECT `+streamColumns+` FROM streams WHERE id = ?`, id))
}

func listStreams(ctx context.Context, db *sql.DB) ([]streamRecord, error) {
	rows, err := db.QueryContext(ctx, `SELECT `+streamColumns+` FROM streams ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []streamRecord
	for rows.Next() {
		stream, err := scanStream(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, stream)
	}
	return result, rows.Err()
}

func streamTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func tokenMatches(stored, token string) bool {
	if stored == "" || token == "" {
		return false
	}
	got := streamTokenHash(token)
	return strings.EqualFold(stored, got)
}

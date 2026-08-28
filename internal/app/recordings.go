package app

import (
	"encoding/base64"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type recordingView struct {
	ID        string    `json:"id"`
	StreamID  string    `json:"streamId,omitempty"`
	Name      string    `json:"name"`
	SizeBytes int64     `json:"sizeBytes"`
	UpdatedAt time.Time `json:"updatedAt"`
	Download  string    `json:"downloadUrl"`
}

func (a *App) listRecordings() ([]recordingView, error) {
	root := filepath.Join(a.cfg.DataDir, "recordings")
	result := make([]recordingView, 0)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		id := base64.RawURLEncoding.EncodeToString([]byte(rel))
		streamID := ""
		parts := strings.Split(rel, "/")
		if len(parts) > 1 {
			streamID = a.streamIDForPath(parts[0])
		}
		result = append(result, recordingView{ID: id, StreamID: streamID, Name: rel, SizeBytes: info.Size(), UpdatedAt: info.ModTime().UTC(), Download: "/api/recordings/" + id + "/download"})
		return nil
	})
	if os.IsNotExist(err) {
		return []recordingView{}, nil
	}
	return result, err
}

func (a *App) streamIDForPath(path string) string {
	var id string
	_ = a.db.QueryRow(`SELECT id FROM streams WHERE path = ?`, path).Scan(&id)
	return id
}

func (a *App) recordingFile(id string) (string, error) {
	relBytes, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil {
		return "", fmt.Errorf("invalid recording id")
	}
	rel := filepath.FromSlash(string(relBytes))
	root, err := filepath.Abs(filepath.Join(a.cfg.DataDir, "recordings"))
	if err != nil {
		return "", err
	}
	full, err := filepath.Abs(filepath.Join(root, rel))
	if err != nil {
		return "", err
	}
	inside, err := filepath.Rel(root, full)
	if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid recording path")
	}
	if info, err := os.Lstat(full); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("symlink recordings are not allowed")
	}
	return full, nil
}

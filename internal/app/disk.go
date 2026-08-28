package app

import (
	"context"
	"log"
	"time"
)

const minimumFreeBytes = 512 * 1024 * 1024

func (a *App) startDiskMonitor(ctx context.Context) {
	a.diskOnce.Do(func() {
		go func() {
			// ponytail: one 30-second disk monitor; a dedicated metrics worker only matters at larger scale.
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				a.checkDisk(ctx)
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
			}
		}()
	})
}

func (a *App) checkDisk(ctx context.Context) {
	free, total, err := diskSpace(a.cfg.DataDir)
	if err != nil || total == 0 {
		return
	}
	if free >= minimumFreeBytes && free >= total/10 {
		return
	}

	rows, err := a.db.QueryContext(ctx, `SELECT id, path FROM streams WHERE status IN ('ready', 'connecting', 'live') AND record = 1`)
	if err != nil {
		log.Printf("disk guard query: %v", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, path string
		if err := rows.Scan(&id, &path); err != nil {
			continue
		}
		if err := a.media.patchPath(ctx, path, false); err != nil {
			log.Printf("disk guard could not stop recording for %s: %v", id, err)
			continue
		}
		if _, err := a.db.ExecContext(ctx, `UPDATE streams SET record = 0 WHERE id = ?`, id); err != nil {
			log.Printf("disk guard database update for %s: %v", id, err)
			continue
		}
		log.Printf("disk guard disabled recording for %s (%d bytes free)", id, free)
	}
}

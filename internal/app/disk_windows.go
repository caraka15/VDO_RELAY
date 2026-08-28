//go:build windows

package app

import "errors"

func diskSpace(path string) (free, total uint64, err error) {
	return 0, 0, errors.New("disk space check is only implemented for the Linux deployment target")
}

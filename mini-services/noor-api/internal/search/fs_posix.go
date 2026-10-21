//go:build !windows

package search

import (
	"os"
	"syscall"
)

func osStat(path string) (os.FileInfo, error) { return os.Stat(path) }

func fileInode(fi os.FileInfo) uint64 {
	if sys, ok := fi.Sys().(*syscall.Stat_t); ok {
		return uint64(sys.Ino)
	}
	return 0
}

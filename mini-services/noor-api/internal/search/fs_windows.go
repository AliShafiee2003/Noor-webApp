//go:build windows

package search

import "os"

func osStat(path string) (os.FileInfo, error) { return os.Stat(path) }

func fileInode(fi os.FileInfo) uint64 {
	if fi == nil {
		return 0
	}
	return uint64(fi.ModTime().UnixNano())
}

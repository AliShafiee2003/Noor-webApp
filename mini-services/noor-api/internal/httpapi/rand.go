package httpapi

import "crypto/rand"

func randReadLocal(b []byte) (int, error) { return rand.Read(b) }

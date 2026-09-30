package research

import "crypto/rand"

func cryptoRead(b []byte) (int, error) { return rand.Read(b) }

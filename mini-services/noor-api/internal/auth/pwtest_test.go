package auth

import (
	"fmt"
	"testing"
)

func TestPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("NoorAdmin1404!")
	if err != nil {
		t.Fatal(err)
	}
	ok, _, err := VerifyPassword("NoorAdmin1404!", hash)
	fmt.Println("roundtrip:", ok, err)
	if err != nil || !ok {
		t.Fatal("roundtrip failed")
	}
}

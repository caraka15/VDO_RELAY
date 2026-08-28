package app

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	passwordMemory  = 64 * 1024
	passwordTime    = 1
	passwordThreads = 4
	passwordKeyLen  = 32
	passwordSaltLen = 16
)

func hashPassword(password string) (string, error) {
	salt := make([]byte, passwordSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, passwordTime, passwordMemory, passwordThreads, passwordKeyLen)
	return fmt.Sprintf("argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		passwordMemory, passwordTime, passwordThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 || parts[0] != "argon2id" || parts[1] != "v=19" {
		return false
	}
	params := strings.Split(parts[2], ",")
	if len(params) != 3 {
		return false
	}
	values := make(map[string]uint32, len(params))
	for _, item := range params {
		pair := strings.SplitN(item, "=", 2)
		if len(pair) != 2 {
			return false
		}
		value, err := strconv.ParseUint(pair[1], 10, 32)
		if err != nil || value == 0 {
			return false
		}
		values[pair[0]] = uint32(value)
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil || len(salt) < 8 {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(expected) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, values["t"], values["m"], uint8(values["p"]), uint32(len(expected)))
	return subtle.ConstantTimeCompare(got, expected) == 1
}

func validNewPassword(password string) bool {
	return len([]rune(password)) >= 10 && len([]rune(password)) <= 128
}

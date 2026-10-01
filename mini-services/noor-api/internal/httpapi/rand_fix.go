package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
)

func chiGetReqID(r *httpRequest) string {
	return middleware.GetReqID(r.Context())
}

type httpRequest = http.Request

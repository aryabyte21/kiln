Add a new API endpoint to the OpenSwarm control plane.

Endpoint to add: $ARGUMENTS

Follow this workflow:

1. Read `apps/controlplane/internal/api/server.go` to understand the existing router pattern
2. Read relevant domain types in `apps/controlplane/internal/domain/`
3. Add the route in the `NewServer` function using Go 1.22+ pattern matching (`mux.HandleFunc("METHOD /path/{param}", handler)`)
4. Implement the handler method on the `*Server` struct
5. Use `s.writeJSON(w, statusCode, data)` for responses
6. Use `s.corsMiddleware(handler)` wrapper for CORS
7. Run `go vet ./...` and `go build ./cmd/openswarm-controller` from `apps/controlplane/`

Handler conventions:

- Extract path params: `r.PathValue("name")`
- Parse JSON body: `json.NewDecoder(r.Body).Decode(&req)`
- Error responses: `http.Error(w, message, statusCode)`
- Always pass `context.Context` to downstream calls
- Log with `slog.Info/Error` including relevant fields

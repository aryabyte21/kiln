# AGENTS Instructions for `apps/go-api`

## Stack

- Go net/http
- Standard library only

## Commands

```bash
go run ./cmd/server
gofmt -l .
go test ./...
go vet ./...
```

## Rules

- Keep handlers simple and free of side effects.
- Add table-driven tests as endpoints grow.
- Add middleware only when justified by cross-cutting needs.

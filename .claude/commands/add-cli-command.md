Add a new CLI command to the OpenSwarm CLI.

Command to add: $ARGUMENTS

Follow this workflow:

1. Read `apps/controlplane/cmd/openswarm/main.go` to understand existing command patterns
2. All commands use Cobra. The CLI talks to the control plane at `OPENSWARM_ADDR` (default `http://localhost:9090`)
3. Add the new command as a `&cobra.Command{}` with appropriate Use, Short, Args, and RunE fields
4. Wire it to the parent command with `parentCmd.AddCommand(newCmd)`
5. Implement the RunE function to make HTTP calls to the control plane API
6. Use `fmt.Fprintf(os.Stdout, ...)` for output, `fmt.Fprintf(os.Stderr, ...)` for errors
7. Run `go build ./cmd/openswarm` from `apps/controlplane/` to verify

Patterns:

- GET requests: `http.Get(addr + "/api/v1/...")`
- POST requests: `http.Post(addr + "/api/v1/...", "application/json", bytes.NewReader(body))`
- Table output: use `fmt.Fprintf` with `%-20s` style formatting
- Env var: `os.Getenv("OPENSWARM_ADDR")` with `http://localhost:9090` fallback

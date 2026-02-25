package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/openswarm/openswarm/internal/config"
	"github.com/openswarm/openswarm/internal/domain"
	"github.com/spf13/cobra"
)

var version = "0.1.0-dev"

func main() {
	rootCmd := &cobra.Command{
		Use:   "openswarm",
		Short: "OpenSwarm — Kubernetes for AI agents",
		Long:  "OpenSwarm orchestrates fleets of OpenClaw AI agent instances with scheduling, monitoring, governance, and evolutionary optimization.",
	}

	rootCmd.AddCommand(versionCmd())
	rootCmd.AddCommand(applyCmd())
	rootCmd.AddCommand(statusCmd())
	rootCmd.AddCommand(agentsCmd())
	rootCmd.AddCommand(tasksCmd())
	rootCmd.AddCommand(psCmd())
	rootCmd.AddCommand(policyCmd())
	rootCmd.AddCommand(downCmd())
	rootCmd.AddCommand(chatCmd())
	rootCmd.AddCommand(sendCmd())

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the OpenSwarm version",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Printf("openswarm %s\n", version)
		},
	}
}

var controlPlaneAddr string

func init() {
	controlPlaneAddr = os.Getenv("OPENSWARM_ADDR")
	if controlPlaneAddr == "" {
		controlPlaneAddr = "http://localhost:9090"
	}
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

func applyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "apply <file-or-dir>",
		Short: "Apply a swarm manifest or policy file",
		Long:  "Apply a swarm.yaml, policy YAML, or a directory of policy files to the control plane.",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path := args[0]

			info, err := os.Stat(path)
			if err != nil {
				return fmt.Errorf("cannot read %s: %w", path, err)
			}

			// Directory: apply all policy files
			if info.IsDir() {
				policies, err := config.LoadPoliciesFromDir(path)
				if err != nil {
					return err
				}
				for _, p := range policies {
					if err := postJSON("/api/v1/policies", p); err != nil {
						return fmt.Errorf("apply policy %s: %w", p.Metadata.Name, err)
					}
					fmt.Printf("policy/%s applied\n", p.Metadata.Name)
				}
				return nil
			}

			// Single file: detect kind from content
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}

			// Try swarm manifest first
			if swarm, err := config.ParseSwarmManifest(data); err == nil {
				if err := postJSON("/api/v1/swarms", swarm); err != nil {
					return fmt.Errorf("apply swarm: %w", err)
				}
				fmt.Printf("swarm/%s applied\n", swarm.Metadata.Name)
				return nil
			}

			// Try policy manifest
			if policy, err := config.ParsePolicyManifest(data); err == nil {
				if err := postJSON("/api/v1/policies", policy); err != nil {
					return fmt.Errorf("apply policy: %w", err)
				}
				fmt.Printf("policy/%s applied\n", policy.Metadata.Name)
				return nil
			}

			return fmt.Errorf("cannot parse %s as swarm or policy manifest (check apiVersion and kind)", filepath.Base(path))
		},
	}
	return cmd
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

func statusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status [swarm]",
		Short: "Show swarm status",
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) > 0 {
				return showSwarmDetail(args[0])
			}

			// List all swarms
			var swarms []domain.Swarm
			if err := getJSON("/api/v1/swarms", &swarms); err != nil {
				return err
			}
			if len(swarms) == 0 {
				fmt.Println("No swarms found.")
				return nil
			}

			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "NAME\tSTATUS\tAGENTS\tCREATED")
			for _, s := range swarms {
				fmt.Fprintf(tw, "%s\t%s\t%d\t%s\n",
					s.Name, s.Status, len(s.Spec.Agents),
					s.CreatedAt.Format(time.RFC3339))
			}
			tw.Flush()
			return nil
		},
	}
}

func showSwarmDetail(name string) error {
	var sw domain.Swarm
	if err := getJSON("/api/v1/swarms/"+name, &sw); err != nil {
		return err
	}

	fmt.Printf("Name:    %s\n", sw.Name)
	fmt.Printf("Status:  %s\n", sw.Status)
	fmt.Printf("Created: %s\n", sw.CreatedAt.Format(time.RFC3339))
	fmt.Printf("Budget:  %s (alert: %d%%, hard stop: %d%%)\n",
		sw.Spec.Budget.Total, sw.Spec.Budget.AlertAt, sw.Spec.Budget.HardStop)
	fmt.Println()

	tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "ROLE\tMODEL\tMIN\tMAX\tSCALE ON\tPOLICY")
	for _, a := range sw.Spec.Agents {
		fmt.Fprintf(tw, "%s\t%s\t%d\t%d\t%s\t%s\n",
			a.Name, a.Model, a.Replicas.Min, a.Replicas.Max,
			a.Replicas.ScaleOn, a.Policy)
	}
	tw.Flush()

	if len(sw.Spec.Topology) > 0 {
		fmt.Println("\nTopology:")
		for _, e := range sw.Spec.Topology {
			fmt.Printf("  %s → %s  [%s]\n", e.From, e.To, e.Subject)
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// agents
// ---------------------------------------------------------------------------

func agentsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "agents <swarm>",
		Short: "List agents in a swarm",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var agents []domain.Agent
			if err := getJSON("/api/v1/swarms/"+args[0]+"/agents", &agents); err != nil {
				return err
			}
			if len(agents) == 0 {
				fmt.Println("No agents registered.")
				return nil
			}

			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "ID\tROLE\tSTATUS\tMODEL\tADDRESS\tLAST SEEN")
			for _, a := range agents {
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%s\n",
					truncate(a.ID, 12), a.Role, a.Status, a.Model,
					a.OpenClawAddr, a.LastSeen.Format("15:04:05"))
			}
			tw.Flush()
			return nil
		},
	}
	return cmd
}

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

func tasksCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "tasks <swarm>",
		Short: "List or submit tasks",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var tasks []domain.Task
			if err := getJSON("/api/v1/swarms/"+args[0]+"/tasks", &tasks); err != nil {
				return err
			}
			if len(tasks) == 0 {
				fmt.Println("No tasks found.")
				return nil
			}

			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "ID\tROLE\tSTATUS\tTOKENS\tCOST\tCREATED")
			for _, t := range tasks {
				fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t$%.4f\t%s\n",
					truncate(t.ID, 12), t.AgentRole, t.Status,
					t.TokensUsed, t.CostUSD,
					t.CreatedAt.Format("15:04:05"))
			}
			tw.Flush()
			return nil
		},
	}

	var submitSwarm string
	submitCmd := &cobra.Command{
		Use:   "submit <swarm> <input>",
		Short: "Submit a new task",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			swarm := args[0]
			if submitSwarm != "" {
				swarm = submitSwarm
			}

			body := domain.TaskSubmission{
				Input: args[1],
			}
			if err := postJSON("/api/v1/swarms/"+swarm+"/tasks", body); err != nil {
				return err
			}
			fmt.Println("Task submitted.")
			return nil
		},
	}
	submitCmd.Flags().StringVar(&submitSwarm, "swarm", "", "Override swarm name")
	cmd.AddCommand(submitCmd)
	return cmd
}

// ---------------------------------------------------------------------------
// ps — quick status
// ---------------------------------------------------------------------------

func psCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "ps",
		Short: "Quick status — one line per swarm",
		RunE: func(cmd *cobra.Command, args []string) error {
			var swarms []domain.Swarm
			if err := getJSON("/api/v1/swarms", &swarms); err != nil {
				return err
			}
			if len(swarms) == 0 {
				fmt.Println("No swarms running.")
				return nil
			}

			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "SWARM\tSTATUS\tAGENTS\tBUDGET\tAGE")
			for _, s := range swarms {
				age := time.Since(s.CreatedAt).Truncate(time.Second)
				fmt.Fprintf(tw, "%s\t%s\t%d\t%s\t%s\n",
					s.Name, s.Status, len(s.Spec.Agents),
					s.Spec.Budget.Total, age)
			}
			tw.Flush()
			return nil
		},
	}
}

// ---------------------------------------------------------------------------
// policy
// ---------------------------------------------------------------------------

func policyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "policy",
		Short: "Manage agent policies",
	}

	cmd.AddCommand(
		&cobra.Command{Use: "list", Short: "List policies",
			RunE: func(cmd *cobra.Command, args []string) error {
				var policies []domain.Policy
				if err := getJSON("/api/v1/policies", &policies); err != nil {
					return err
				}
				if len(policies) == 0 {
					fmt.Println("No policies found.")
					return nil
				}
				tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
				fmt.Fprintln(tw, "NAME\tCREATED")
				for _, p := range policies {
					fmt.Fprintf(tw, "%s\t%s\n", p.Name, p.CreatedAt.Format(time.RFC3339))
				}
				tw.Flush()
				return nil
			}},
	)
	return cmd
}

func downCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "down <swarm>",
		Short: "Gracefully shut down a swarm",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			req, _ := http.NewRequest("DELETE", controlPlaneAddr+"/api/v1/swarms/"+args[0], nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				return fmt.Errorf("failed to connect to control plane: %w", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					return fmt.Errorf("failed to read response body: %w", err)
				}
				return fmt.Errorf("delete failed: %s", string(body))
			}
			fmt.Printf("swarm/%s deleted\n", args[0])
			return nil
		},
	}
}

// ---------------------------------------------------------------------------
// chat — interactive REPL
// ---------------------------------------------------------------------------

func chatCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "chat <swarm>/<role>",
		Short: "Interactive chat session with an agent",
		Long:  "Opens an interactive REPL that sends messages to an agent via the control plane chat proxy.",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			parts := strings.SplitN(args[0], "/", 2)
			if len(parts) != 2 {
				return fmt.Errorf("usage: openswarm chat <swarm>/<role>")
			}
			swarmName, role := parts[0], parts[1]

			containerID, err := findContainerForRole(swarmName, role)
			if err != nil {
				return err
			}

			fmt.Printf("Connected to %s/%s (container %s). Type 'exit' to quit.\n\n", swarmName, role, containerID)

			scanner := bufio.NewScanner(os.Stdin)
			for {
				fmt.Print("> ")
				if !scanner.Scan() {
					break
				}
				input := strings.TrimSpace(scanner.Text())
				if input == "" {
					continue
				}
				if input == "exit" || input == "quit" {
					break
				}

				chatReq := map[string]any{
					"messages": []map[string]string{
						{"role": "user", "content": input},
					},
				}
				respBody, err := postJSONRaw(fmt.Sprintf("/api/v1/containers/%s/chat", containerID), chatReq)
				if err != nil {
					fmt.Fprintf(os.Stderr, "Error: %v\n", err)
					continue
				}

				var chatResp map[string]any
				if err := json.Unmarshal(respBody, &chatResp); err != nil {
					fmt.Fprintf(os.Stderr, "Parse error: %v\n", err)
					continue
				}

				if choices, ok := chatResp["choices"].([]any); ok && len(choices) > 0 {
					if choice, ok := choices[0].(map[string]any); ok {
						if msg, ok := choice["message"].(map[string]any); ok {
							if content, ok := msg["content"].(string); ok {
								fmt.Printf("\n%s\n\n", content)
							}
						}
					}
				}
			}

			fmt.Println("Session ended.")
			return nil
		},
	}
}

// ---------------------------------------------------------------------------
// send — one-shot message
// ---------------------------------------------------------------------------

func sendCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "send <swarm>/<role> <message>",
		Short: "Send a one-shot message to an agent",
		Args:  cobra.MinimumNArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			parts := strings.SplitN(args[0], "/", 2)
			if len(parts) != 2 {
				return fmt.Errorf("usage: openswarm send <swarm>/<role> <message>")
			}
			swarmName, role := parts[0], parts[1]
			message := strings.Join(args[1:], " ")

			containerID, err := findContainerForRole(swarmName, role)
			if err != nil {
				return err
			}

			chatReq := map[string]any{
				"messages": []map[string]string{
					{"role": "user", "content": message},
				},
			}
			respBody, err := postJSONRaw(fmt.Sprintf("/api/v1/containers/%s/chat", containerID), chatReq)
			if err != nil {
				return err
			}

			var chatResp map[string]any
			if err := json.Unmarshal(respBody, &chatResp); err != nil {
				return fmt.Errorf("parse response: %w", err)
			}

			if choices, ok := chatResp["choices"].([]any); ok && len(choices) > 0 {
				if choice, ok := choices[0].(map[string]any); ok {
					if msg, ok := choice["message"].(map[string]any); ok {
						if content, ok := msg["content"].(string); ok {
							fmt.Println(content)
						}
					}
				}
			}

			return nil
		},
	}
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

func findContainerForRole(swarmName, role string) (string, error) {
	type containerInfo struct {
		ID   string `json:"id"`
		Role string `json:"role"`
	}
	var containers []containerInfo
	if err := getJSON(fmt.Sprintf("/api/v1/swarms/%s/containers", swarmName), &containers); err != nil {
		return "", fmt.Errorf("list containers: %w", err)
	}
	for _, c := range containers {
		if c.Role == role {
			return c.ID, nil
		}
	}
	return "", fmt.Errorf("no container found for %s/%s", swarmName, role)
}

func postJSONRaw(path string, v any) ([]byte, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}

	resp, err := http.Post(controlPlaneAddr+path, "application/json", bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to control plane at %s: %w", controlPlaneAddr, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("server error (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}

func postJSON(path string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	resp, err := http.Post(controlPlaneAddr+path, "application/json", bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to connect to control plane at %s: %w", controlPlaneAddr, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("failed to read response body: %w", err)
		}
		return fmt.Errorf("server error (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func getJSON(path string, target any) error {
	resp, err := http.Get(controlPlaneAddr + path)
	if err != nil {
		return fmt.Errorf("failed to connect to control plane at %s: %w", controlPlaneAddr, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("failed to read response body: %w", err)
		}
		return fmt.Errorf("server error (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	return json.NewDecoder(resp.Body).Decode(target)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

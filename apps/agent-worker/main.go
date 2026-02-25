package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

var (
	soulPrompt string
	ollamaURL  string
	modelName  string
	agentRole  string
	startTime  time.Time
	client     = &http.Client{Timeout: 120 * time.Second}
)

func main() {
	startTime = time.Now()
	agentRole = env("AGENT_ROLE", "agent")
	ollamaURL = env("OLLAMA_URL", "http://host.docker.internal:11434")
	modelName = env("MODEL_NAME", "qwen2.5:7b")
	port := env("PORT", "8080")

	// Read SOUL.md
	soulBytes, err := os.ReadFile("/workspace/SOUL.md")
	if err != nil {
		log.Printf("WARN: no SOUL.md found, using default system prompt: %v", err)
		soulPrompt = fmt.Sprintf("You are a %s agent. Complete tasks thoroughly and accurately.", agentRole)
	} else {
		soulPrompt = string(soulBytes)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealth)
	mux.HandleFunc("POST /v1/chat/completions", handleChat)

	log.Printf("agent-worker starting role=%s model=%s ollama=%s port=%s", agentRole, modelName, ollamaURL, port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok",
		"role":   agentRole,
		"model":  modelName,
		"uptime": time.Since(startTime).String(),
	})
}

// handleChat implements the OpenAI-compatible /v1/chat/completions endpoint.
// It prepends the SOUL.md system prompt and proxies to Ollama.
func handleChat(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Model    string              `json:"model"`
		Messages []map[string]string `json:"messages"`
		Stream   bool                `json:"stream"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	// Build messages: system prompt + user messages
	messages := []map[string]string{
		{"role": "system", "content": soulPrompt},
	}
	messages = append(messages, req.Messages...)

	// Call Ollama /api/chat
	ollamaReq := map[string]interface{}{
		"model":    modelName,
		"messages": messages,
		"stream":   false,
	}
	body, _ := json.Marshal(ollamaReq)
	resp, err := client.Post(ollamaURL+"/api/chat", "application/json", bytes.NewReader(body))
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"ollama call failed: %s"}`, err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf(`{"error":"ollama returned %d: %s"}`, resp.StatusCode, truncate(string(respBody), 200)), resp.StatusCode)
		return
	}

	// Parse Ollama response
	var ollamaResp struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		TotalDuration   int64 `json:"total_duration"`
		PromptEvalCount int   `json:"prompt_eval_count"`
		EvalCount       int   `json:"eval_count"`
	}
	if err := json.Unmarshal(respBody, &ollamaResp); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"parse ollama response: %s"}`, err), http.StatusBadGateway)
		return
	}

	// Convert to OpenAI-compatible response format
	openaiResp := map[string]interface{}{
		"id":      fmt.Sprintf("osw-%d", time.Now().UnixNano()),
		"object":  "chat.completion",
		"created": time.Now().Unix(),
		"model":   modelName,
		"choices": []map[string]interface{}{
			{
				"index":         0,
				"message":       map[string]string{"role": "assistant", "content": ollamaResp.Message.Content},
				"finish_reason": "stop",
			},
		},
		"usage": map[string]int{
			"prompt_tokens":     ollamaResp.PromptEvalCount,
			"completion_tokens": ollamaResp.EvalCount,
			"total_tokens":      ollamaResp.PromptEvalCount + ollamaResp.EvalCount,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(openaiResp)
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func truncate(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}

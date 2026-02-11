# Payment Processing System - Technical Implementation Details

## 1. Transaction State Machine Implementation

### State Transitions

```go
// Transaction states
const (
    StateInitiated     = "INITIATED"
    StateFraudCheck    = "FRAUD_CHECK"
    StateAuthorized    = "AUTHORIZED"
    StateCaptured      = "CAPTURED"
    StateRefunded      = "REFUNDED"
    StateVoided        = "VOIDED"
    StateSettled       = "SETTLED"
    StateDeclined      = "DECLINED"
    StateRejected      = "REJECTED"
)

// Valid state transitions
var transitions = map[string][]string{
    StateInitiated: {StateFraudCheck, StateRejected},
    StateFraudCheck: {StateAuthorized, StateRejected},
    StateAuthorized: {StateCaptured, StateVoided, StateDeclined},
    StateCaptured: {StateRefunded, StateSettled},
    StateRefunded: {StateSettled},
    StateVoided: {}, // Terminal state
    StateDeclined: {}, // Terminal state
    StateRejected: {}, // Terminal state
    StateSettled: {}, // Terminal state
}

// TransactionStateMachine manages state transitions
type TransactionStateMachine struct {
    repo TransactionRepository
}

func (sm *TransactionStateMachine) Transition(
    ctx context.Context,
    txnID uuid.UUID,
    toState string,
    metadata map[string]interface{},
) error {
    // Get current transaction with row-level locking
    txn, err := sm.repo.GetForUpdate(ctx, txnID)
    if err != nil {
        return fmt.Errorf("failed to get transaction: %w", err)
    }

    // Validate transition
    if !sm.isValidTransition(txn.Status, toState) {
        return fmt.Errorf("invalid transition from %s to %s", txn.Status, toState)
    }

    // Update status with optimistic locking
    err = sm.repo.UpdateStatus(ctx, txnID, toState, txn.Version, metadata)
    if err != nil {
        return fmt.Errorf("failed to update status: %w", err)
    }

    // Publish state change event
    event := TransactionEvent{
        TransactionID: txnID,
        FromStatus:    txn.Status,
        ToStatus:      toState,
        Metadata:      metadata,
        Timestamp:     time.Now(),
    }
    sm.publishEvent(ctx, event)

    return nil
}

func (sm *TransactionStateMachine) isValidTransition(from, to string) bool {
    validStates, ok := transitions[from]
    if !ok {
        return false
    }
    for _, state := range validStates {
        if state == to {
            return true
        }
    }
    return false
}
```

---

## 2. Idempotency Implementation

### Middleware Pattern

```go
// IdempotencyMiddleware ensures idempotent request handling
func IdempotencyMiddleware(redis *redis.Client, ttl time.Duration) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            // Only apply to mutating operations
            if r.Method == http.MethodGet || r.Method == http.MethodHead {
                next.ServeHTTP(w, r)
                return
            }

            // Get idempotency key from header
            key := r.Header.Get("Idempotency-Key")
            if key == "" {
                http.Error(w, "Idempotency-Key header required", http.StatusBadRequest)
                return
            }

            // Check if request already processed
            redisKey := fmt.Sprintf("idempotency:%s", key)
            cached, err := redis.Get(r.Context(), redisKey).Result()
            if err == nil {
                // Return cached response
                var response IdempotentResponse
                json.Unmarshal([]byte(cached), &response)
                w.Header().Set("Content-Type", "application/json")
                w.WriteHeader(response.StatusCode)
                w.Write(response.Body)
                return
            } else if err != redis.Nil {
                // Redis error, fail safe by rejecting
                http.Error(w, "Internal server error", http.StatusInternalServerError)
                return
            }

            // Acquire lock to prevent concurrent processing
            lockKey := fmt.Sprintf("idempotency:lock:%s", key)
            acquired, err := redis.SetNX(r.Context(), lockKey, "1", 30*time.Second).Result()
            if err != nil || !acquired {
                // Another request is processing
                http.Error(w, "Request already in progress", http.StatusConflict)
                return
            }
            defer redis.Del(r.Context(), lockKey)

            // Capture response
            recorder := &responseRecorder{
                ResponseWriter: w,
                statusCode:     http.StatusOK,
                body:           &bytes.Buffer{},
            }

            // Process request
            next.ServeHTTP(recorder, r)

            // Cache response
            response := IdempotentResponse{
                StatusCode: recorder.statusCode,
                Body:       recorder.body.Bytes(),
            }
            data, _ := json.Marshal(response)
            redis.Set(r.Context(), redisKey, data, ttl)
        })
    }
}

type IdempotentResponse struct {
    StatusCode int
    Body       []byte
}

type responseRecorder struct {
    http.ResponseWriter
    statusCode int
    body       *bytes.Buffer
}

func (r *responseRecorder) WriteHeader(statusCode int) {
    r.statusCode = statusCode
    r.ResponseWriter.WriteHeader(statusCode)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
    r.body.Write(b)
    return r.ResponseWriter.Write(b)
}
```

---

## 3. Saga Pattern for Payment Authorization

### Orchestration-Based Saga

```go
// PaymentSaga orchestrates the payment authorization flow
type PaymentSaga struct {
    txnService    TransactionService
    fraudService  FraudDetectionService
    gatewayService GatewayAdapterService
    eventBus      EventBus
}

// Authorize executes the payment authorization saga
func (s *PaymentSaga) Authorize(ctx context.Context, req *AuthorizeRequest) (*AuthorizeResponse, error) {
    var txnID uuid.UUID
    var compensations []func(context.Context) error

    // Step 1: Create transaction
    txn, err := s.txnService.Create(ctx, &CreateTransactionRequest{
        Amount:   req.Amount,
        Currency: req.Currency,
        MerchantID: req.MerchantID,
        CustomerID: req.CustomerID,
        PaymentMethodID: req.PaymentMethodID,
    })
    if err != nil {
        return nil, fmt.Errorf("failed to create transaction: %w", err)
    }
    txnID = txn.ID

    // Compensation: Mark transaction as failed
    compensations = append(compensations, func(ctx context.Context) error {
        return s.txnService.UpdateStatus(ctx, txnID, StateRejected, nil)
    })

    // Step 2: Fraud check (with timeout)
    fraudCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()

    fraudResult, err := s.fraudService.Analyze(fraudCtx, &FraudAnalyzeRequest{
        TransactionID: txnID,
        Amount:        req.Amount,
        Currency:      req.Currency,
        CustomerID:    req.CustomerID,
        IPAddress:     req.IPAddress,
    })

    if err != nil {
        // Timeout or error - proceed with default score
        fraudResult = &FraudAnalyzeResponse{Score: 50.0}
        log.Warn("Fraud detection timeout, using default score", "txn_id", txnID)
    }

    if fraudResult.Score > 90.0 {
        // High fraud risk - reject and compensate
        s.runCompensations(ctx, compensations)
        return nil, &FraudRejectedError{
            TransactionID: txnID,
            Score:         fraudResult.Score,
        }
    }

    // Step 3: Authorize with gateway
    gatewayResp, err := s.gatewayService.Authorize(ctx, &GatewayAuthorizeRequest{
        TransactionID:   txnID,
        Amount:          req.Amount,
        Currency:        req.Currency,
        PaymentMethodID: req.PaymentMethodID,
    })
    if err != nil {
        // Gateway error - compensate
        s.runCompensations(ctx, compensations)
        return nil, fmt.Errorf("gateway authorization failed: %w", err)
    }

    if !gatewayResp.Success {
        // Declined - compensate
        s.runCompensations(ctx, compensations)
        return nil, &DeclinedError{
            TransactionID: txnID,
            Code:          gatewayResp.DeclineCode,
            Message:       gatewayResp.DeclineMessage,
        }
    }

    // Step 4: Update transaction to authorized
    err = s.txnService.UpdateStatus(ctx, txnID, StateAuthorized, map[string]interface{}{
        "gateway_transaction_id": gatewayResp.GatewayTransactionID,
        "fraud_score":            fraudResult.Score,
    })
    if err != nil {
        // Critical: Transaction authorized at gateway but failed to update DB
        // Compensation: Void the authorization
        s.gatewayService.Void(ctx, &GatewayVoidRequest{
            GatewayTransactionID: gatewayResp.GatewayTransactionID,
        })
        return nil, fmt.Errorf("failed to update transaction status: %w", err)
    }

    // Success - publish event
    s.eventBus.Publish(ctx, &TransactionAuthorizedEvent{
        TransactionID: txnID,
        Amount:        req.Amount,
        Currency:      req.Currency,
        FraudScore:    fraudResult.Score,
    })

    return &AuthorizeResponse{
        TransactionID:         txnID,
        Status:                StateAuthorized,
        GatewayTransactionID:  gatewayResp.GatewayTransactionID,
        FraudScore:            fraudResult.Score,
    }, nil
}

// runCompensations executes compensation actions in reverse order
func (s *PaymentSaga) runCompensations(ctx context.Context, compensations []func(context.Context) error) {
    for i := len(compensations) - 1; i >= 0; i-- {
        if err := compensations[i](ctx); err != nil {
            log.Error("Compensation failed", "error", err)
        }
    }
}
```

---

## 4. Gateway Adapter with Circuit Breaker

### Circuit Breaker Pattern

```go
import "github.com/sony/gobreaker"

// GatewayAdapter adapts external payment gateway APIs
type GatewayAdapter struct {
    client        *http.Client
    breaker       *gobreaker.CircuitBreaker
    gatewayURL    string
    apiKey        string
}

func NewGatewayAdapter(gatewayURL, apiKey string) *GatewayAdapter {
    settings := gobreaker.Settings{
        Name:        "payment-gateway",
        MaxRequests: 3,
        Interval:    10 * time.Second,
        Timeout:     30 * time.Second,
        ReadyToTrip: func(counts gobreaker.Counts) bool {
            failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
            return counts.Requests >= 5 && failureRatio >= 0.6
        },
        OnStateChange: func(name string, from, to gobreaker.State) {
            log.Info("Circuit breaker state change",
                "gateway", name,
                "from", from,
                "to", to)
        },
    }

    return &GatewayAdapter{
        client:     &http.Client{Timeout: 10 * time.Second},
        breaker:    gobreaker.NewCircuitBreaker(settings),
        gatewayURL: gatewayURL,
        apiKey:     apiKey,
    }
}

// Authorize calls the gateway API with circuit breaker protection
func (a *GatewayAdapter) Authorize(ctx context.Context, req *GatewayAuthorizeRequest) (*GatewayAuthorizeResponse, error) {
    result, err := a.breaker.Execute(func() (interface{}, error) {
        return a.authorize(ctx, req)
    })

    if err != nil {
        if err == gobreaker.ErrOpenState {
            return nil, &GatewayUnavailableError{Message: "Circuit breaker open"}
        }
        return nil, err
    }

    return result.(*GatewayAuthorizeResponse), nil
}

func (a *GatewayAdapter) authorize(ctx context.Context, req *GatewayAuthorizeRequest) (*GatewayAuthorizeResponse, error) {
    // Build request
    body := map[string]interface{}{
        "amount":   req.Amount,
        "currency": req.Currency,
        "token":    req.PaymentMethodID,
    }
    data, _ := json.Marshal(body)

    httpReq, err := http.NewRequestWithContext(ctx, "POST", a.gatewayURL+"/charges", bytes.NewReader(data))
    if err != nil {
        return nil, err
    }

    httpReq.Header.Set("Authorization", "Bearer "+a.apiKey)
    httpReq.Header.Set("Content-Type", "application/json")

    // Execute request with retry
    var resp *http.Response
    err = a.retryWithBackoff(ctx, func() error {
        resp, err = a.client.Do(httpReq)
        return err
    }, 3)

    if err != nil {
        return nil, fmt.Errorf("gateway request failed: %w", err)
    }
    defer resp.Body.Close()

    // Parse response
    if resp.StatusCode >= 500 {
        return nil, fmt.Errorf("gateway server error: %d", resp.StatusCode)
    }

    var gatewayResp struct {
        ID       string `json:"id"`
        Status   string `json:"status"`
        DeclineCode string `json:"decline_code"`
        Message  string `json:"message"`
    }
    json.NewDecoder(resp.Body).Decode(&gatewayResp)

    if gatewayResp.Status == "succeeded" {
        return &GatewayAuthorizeResponse{
            Success:              true,
            GatewayTransactionID: gatewayResp.ID,
        }, nil
    }

    return &GatewayAuthorizeResponse{
        Success:        false,
        DeclineCode:    gatewayResp.DeclineCode,
        DeclineMessage: gatewayResp.Message,
    }, nil
}

// retryWithBackoff implements exponential backoff retry
func (a *GatewayAdapter) retryWithBackoff(ctx context.Context, fn func() error, maxRetries int) error {
    var err error
    for i := 0; i < maxRetries; i++ {
        err = fn()
        if err == nil {
            return nil
        }

        // Don't retry on context cancellation
        if ctx.Err() != nil {
            return ctx.Err()
        }

        // Exponential backoff: 1s, 2s, 4s
        backoff := time.Duration(1<<uint(i)) * time.Second
        select {
        case <-time.After(backoff):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return err
}
```

---

## 5. Fraud Detection Service (Rules-Based)

### Rule Engine

```go
// FraudRule defines a fraud detection rule
type FraudRule struct {
    ID          string
    Name        string
    Description string
    Weight      float64
    Evaluate    func(context.Context, *Transaction) (bool, error)
}

// FraudDetectionService evaluates transactions for fraud
type FraudDetectionService struct {
    rules []FraudRule
    redis *redis.Client
}

func NewFraudDetectionService(redis *redis.Client) *FraudDetectionService {
    return &FraudDetectionService{
        redis: redis,
        rules: []FraudRule{
            {
                ID:     "velocity_check",
                Name:   "Velocity Check",
                Weight: 30.0,
                Evaluate: func(ctx context.Context, txn *Transaction) (bool, error) {
                    // Check transaction count per card in last hour
                    key := fmt.Sprintf("fraud:velocity:%s", txn.PaymentMethodID)
                    count, err := redis.Incr(ctx, key).Result()
                    if err != nil {
                        return false, err
                    }
                    redis.Expire(ctx, key, 1*time.Hour)
                    return count > 5, nil // More than 5 txns/hour
                },
            },
            {
                ID:     "amount_check",
                Name:   "Unusual Amount",
                Weight: 20.0,
                Evaluate: func(ctx context.Context, txn *Transaction) (bool, error) {
                    // Check if amount is unusually high
                    return txn.Amount > 100000, nil // >$1000
                },
            },
            {
                ID:     "geo_mismatch",
                Name:   "Geolocation Mismatch",
                Weight: 25.0,
                Evaluate: func(ctx context.Context, txn *Transaction) (bool, error) {
                    // Check if IP country matches billing country
                    // (Simplified - would use actual geolocation service)
                    return false, nil
                },
            },
            {
                ID:     "blacklist_check",
                Name:   "Blacklist Check",
                Weight: 50.0,
                Evaluate: func(ctx context.Context, txn *Transaction) (bool, error) {
                    // Check if customer/card is blacklisted
                    key := fmt.Sprintf("fraud:blacklist:%s", txn.CustomerID)
                    exists, err := redis.Exists(ctx, key).Result()
                    return exists > 0, err
                },
            },
        },
    }
}

// Analyze evaluates a transaction and returns a fraud score (0-100)
func (s *FraudDetectionService) Analyze(ctx context.Context, req *FraudAnalyzeRequest) (*FraudAnalyzeResponse, error) {
    txn := &Transaction{
        ID:              req.TransactionID,
        Amount:          req.Amount,
        Currency:        req.Currency,
        CustomerID:      req.CustomerID,
        PaymentMethodID: req.PaymentMethodID,
        IPAddress:       req.IPAddress,
    }

    var totalScore float64
    triggeredRules := []string{}

    // Evaluate each rule
    for _, rule := range s.rules {
        triggered, err := rule.Evaluate(ctx, txn)
        if err != nil {
            log.Error("Rule evaluation failed", "rule", rule.ID, "error", err)
            continue
        }

        if triggered {
            totalScore += rule.Weight
            triggeredRules = append(triggeredRules, rule.Name)
        }
    }

    // Normalize score to 0-100
    maxScore := 0.0
    for _, rule := range s.rules {
        maxScore += rule.Weight
    }
    normalizedScore := (totalScore / maxScore) * 100

    return &FraudAnalyzeResponse{
        Score:          normalizedScore,
        TriggeredRules: triggeredRules,
    }, nil
}
```

---

## 6. Webhook Delivery with Retry

### Asynchronous Webhook Service

```go
// WebhookDeliveryService handles webhook delivery with retry
type WebhookDeliveryService struct {
    queue  *rabbitmq.Queue
    client *http.Client
}

// Enqueue adds a webhook to the delivery queue
func (s *WebhookDeliveryService) Enqueue(ctx context.Context, webhook *Webhook) error {
    data, _ := json.Marshal(webhook)
    return s.queue.Publish(ctx, data)
}

// Worker processes webhooks from the queue
func (s *WebhookDeliveryService) Worker(ctx context.Context) {
    messages, _ := s.queue.Consume(ctx)

    for msg := range messages {
        var webhook Webhook
        json.Unmarshal(msg.Body, &webhook)

        err := s.deliver(ctx, &webhook)
        if err != nil {
            // Retry with exponential backoff
            if webhook.RetryCount < 10 {
                webhook.RetryCount++
                backoff := time.Duration(1<<uint(webhook.RetryCount)) * time.Second
                time.Sleep(backoff)
                s.Enqueue(ctx, &webhook)
            } else {
                log.Error("Webhook delivery failed after max retries", "url", webhook.URL)
            }
        }

        msg.Ack(false)
    }
}

// deliver sends the webhook HTTP request
func (s *WebhookDeliveryService) deliver(ctx context.Context, webhook *Webhook) error {
    // Sign payload with HMAC
    signature := s.signPayload(webhook.Payload, webhook.Secret)

    req, err := http.NewRequestWithContext(ctx, "POST", webhook.URL, bytes.NewReader(webhook.Payload))
    if err != nil {
        return err
    }

    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("X-Webhook-Signature", signature)
    req.Header.Set("X-Webhook-ID", webhook.ID)

    resp, err := s.client.Do(req)
    if err != nil {
        return fmt.Errorf("request failed: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode >= 200 && resp.StatusCode < 300 {
        return nil
    }

    return fmt.Errorf("webhook returned status %d", resp.StatusCode)
}

// signPayload generates HMAC signature
func (s *WebhookDeliveryService) signPayload(payload []byte, secret string) string {
    h := hmac.New(sha256.New, []byte(secret))
    h.Write(payload)
    return hex.EncodeToString(h.Sum(nil))
}
```

---

## 7. Database Schema (Complete)

```sql
-- Merchants table
CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    webhook_url VARCHAR(500),
    webhook_secret VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- Customers table
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    external_id VARCHAR(255), -- Merchant's customer ID
    email VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    INDEX idx_merchant_external (merchant_id, external_id)
);

-- Payment methods table (Wallet Service)
CREATE TABLE payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    type VARCHAR(50) NOT NULL,
    gateway VARCHAR(50) NOT NULL,
    gateway_token VARCHAR(255) NOT NULL,
    last_four VARCHAR(4),
    card_brand VARCHAR(50),
    expiry_month INT,
    expiry_year INT,
    billing_address JSONB,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    INDEX idx_customer (customer_id)
);

-- Transactions table (Transaction Service)
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(255) UNIQUE,
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    customer_id UUID REFERENCES customers(id),
    amount DECIMAL(19,4) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    status VARCHAR(50) NOT NULL,
    payment_method_id UUID REFERENCES payment_methods(id),
    gateway VARCHAR(50),
    gateway_transaction_id VARCHAR(255),
    fraud_score DECIMAL(5,2),
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 1,
    INDEX idx_merchant_created (merchant_id, created_at),
    INDEX idx_idempotency (idempotency_key),
    INDEX idx_gateway_ref (gateway, gateway_transaction_id),
    INDEX idx_status (status, created_at)
);

-- Transaction events table (Event sourcing for audit)
CREATE TABLE transaction_events (
    id BIGSERIAL PRIMARY KEY,
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    event_type VARCHAR(50) NOT NULL,
    from_status VARCHAR(50),
    to_status VARCHAR(50),
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    INDEX idx_transaction (transaction_id, created_at)
);

-- Audit events table (Audit Service)
CREATE TABLE audit_events (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(50),
    aggregate_id UUID,
    user_id UUID,
    merchant_id UUID,
    payload JSONB NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    INDEX idx_aggregate (aggregate_type, aggregate_id, created_at),
    INDEX idx_merchant (merchant_id, created_at),
    INDEX idx_event_type (event_type, created_at)
);

-- Settlement batches table
CREATE TABLE settlement_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    gateway VARCHAR(50) NOT NULL,
    batch_date DATE NOT NULL,
    total_amount DECIMAL(19,4) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    transaction_count INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    gateway_batch_id VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    INDEX idx_merchant_date (merchant_id, batch_date)
);

-- Webhooks table (Notification Service)
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    url VARCHAR(500) NOT NULL,
    status VARCHAR(50) NOT NULL,
    retry_count INT DEFAULT 0,
    last_attempt_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    INDEX idx_merchant_status (merchant_id, status, created_at)
);

-- Partition transactions table by month
CREATE TABLE transactions_2026_01 PARTITION OF transactions
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE transactions_2026_02 PARTITION OF transactions
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- Continue for each month...
```

---

## 8. Observability Implementation

### Structured Logging

```go
import "log/slog"

// Logger setup with context
func setupLogger() *slog.Logger {
    return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    }))
}

// Log payment authorization
func logAuthorization(ctx context.Context, txnID uuid.UUID, status string) {
    logger.InfoContext(ctx,
        "Payment authorization completed",
        "transaction_id", txnID,
        "status", status,
        "trace_id", getTraceID(ctx),
    )
}
```

### Prometheus Metrics

```go
import "github.com/prometheus/client_golang/prometheus"

var (
    transactionTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "payment_transactions_total",
            Help: "Total number of payment transactions",
        },
        []string{"status", "gateway"},
    )

    transactionDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "payment_transaction_duration_seconds",
            Help:    "Payment transaction duration",
            Buckets: prometheus.DefBuckets,
        },
        []string{"operation"},
    )

    fraudDetectionScore = prometheus.NewHistogram(
        prometheus.HistogramOpts{
            Name:    "fraud_detection_score",
            Help:    "Fraud detection scores",
            Buckets: []float64{0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100},
        },
    )
)

func init() {
    prometheus.MustRegister(transactionTotal)
    prometheus.MustRegister(transactionDuration)
    prometheus.MustRegister(fraudDetectionScore)
}

// Track transaction
func trackTransaction(status, gateway string) {
    transactionTotal.WithLabelValues(status, gateway).Inc()
}

// Track duration
func trackDuration(operation string) func() {
    start := time.Now()
    return func() {
        duration := time.Since(start).Seconds()
        transactionDuration.WithLabelValues(operation).Observe(duration)
    }
}
```

### Distributed Tracing

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/trace"
)

func authorizeWithTracing(ctx context.Context, req *AuthorizeRequest) (*AuthorizeResponse, error) {
    tracer := otel.Tracer("payment-gateway-service")
    ctx, span := tracer.Start(ctx, "authorize_payment")
    defer span.End()

    span.SetAttributes(
        attribute.String("transaction.id", req.TransactionID.String()),
        attribute.Float64("transaction.amount", float64(req.Amount)),
        attribute.String("transaction.currency", req.Currency),
    )

    // Business logic...
    resp, err := authorizePayment(ctx, req)
    if err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        return nil, err
    }

    span.SetStatus(codes.Ok, "")
    return resp, nil
}
```

---

**Document Version:** 1.0
**Last Updated:** 2026-02-09
**Companion to:** payment-processing-architecture.md

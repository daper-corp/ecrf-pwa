#!/bin/bash
# =====================================================
# eCRF PWA - Comprehensive QA Test Suite
# Senior QA Engineer Test Script
# Version: 2.0.0
# =====================================================

set -e

# Configuration
BASE_URL="${BASE_URL:-https://ecrf-pwa.pages.dev}"
LOCAL_URL="http://localhost:3000"
TEST_RESULTS_FILE="test-results-$(date +%Y%m%d-%H%M%S).json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
PASS=0
FAIL=0
SKIP=0

# Test result storage
declare -a TEST_RESULTS=()

# =====================================================
# UTILITY FUNCTIONS
# =====================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASS++))
    TEST_RESULTS+=("{\"test\":\"$1\",\"status\":\"PASS\",\"timestamp\":\"$(date -Iseconds)\"}")
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1 - $2"
    ((FAIL++))
    TEST_RESULTS+=("{\"test\":\"$1\",\"status\":\"FAIL\",\"error\":\"$2\",\"timestamp\":\"$(date -Iseconds)\"}")
}

log_skip() {
    echo -e "${YELLOW}[SKIP]${NC} $1 - $2"
    ((SKIP++))
    TEST_RESULTS+=("{\"test\":\"$1\",\"status\":\"SKIP\",\"reason\":\"$2\",\"timestamp\":\"$(date -Iseconds)\"}")
}

log_section() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

# HTTP request helper
api_call() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local token="$4"
    local expected_status="$5"
    
    local headers=(-H "Content-Type: application/json")
    if [ -n "$token" ]; then
        headers+=(-H "Authorization: Bearer $token")
    fi
    
    local response
    if [ -n "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "${BASE_URL}${endpoint}" "${headers[@]}" -d "$data" 2>/dev/null)
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "${BASE_URL}${endpoint}" "${headers[@]}" 2>/dev/null)
    fi
    
    local status_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    echo "$status_code|$body"
}

# =====================================================
# 1. FUNCTIONAL TESTS - AUTHENTICATION
# =====================================================

test_auth() {
    log_section "1. FUNCTIONAL TESTS - AUTHENTICATION"
    
    # Test 1.1: Health check
    log_info "Testing health endpoint..."
    result=$(api_call "GET" "/api/health" "" "" "200")
    status=$(echo "$result" | cut -d'|' -f1)
    body=$(echo "$result" | cut -d'|' -f2-)
    
    if [ "$status" = "200" ] && echo "$body" | grep -q '"status":"healthy"'; then
        log_pass "Health check returns healthy status"
    else
        log_fail "Health check" "Status: $status, Body: $body"
    fi
    
    # Test 1.2: Login with valid credentials
    log_info "Testing login with valid credentials..."
    result=$(api_call "POST" "/api/auth/login" '{"email":"admin@ecrf.local","password":"Test1234!"}' "" "200")
    status=$(echo "$result" | cut -d'|' -f1)
    body=$(echo "$result" | cut -d'|' -f2-)
    
    if [ "$status" = "200" ] && echo "$body" | grep -q '"success":true'; then
        log_pass "Login with valid credentials"
        TOKEN=$(echo "$body" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
        export AUTH_TOKEN="$TOKEN"
    else
        log_fail "Login with valid credentials" "Status: $status"
    fi
    
    # Test 1.3: Login with invalid credentials
    log_info "Testing login with invalid credentials..."
    result=$(api_call "POST" "/api/auth/login" '{"email":"admin@ecrf.local","password":"wrongpassword"}' "" "401")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "401" ]; then
        log_pass "Login with invalid credentials returns 401"
    else
        log_fail "Login with invalid credentials" "Expected 401, got $status"
    fi
    
    # Test 1.4: Login with missing fields
    log_info "Testing login with missing fields..."
    result=$(api_call "POST" "/api/auth/login" '{"email":"admin@ecrf.local"}' "" "400")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "400" ] || [ "$status" = "401" ]; then
        log_pass "Login with missing password returns error"
    else
        log_fail "Login with missing fields" "Expected 400/401, got $status"
    fi
    
    # Test 1.5: Get current user (authenticated)
    log_info "Testing /api/auth/me with valid token..."
    if [ -n "$AUTH_TOKEN" ]; then
        result=$(api_call "GET" "/api/auth/me" "" "$AUTH_TOKEN" "200")
        status=$(echo "$result" | cut -d'|' -f1)
        body=$(echo "$result" | cut -d'|' -f2-)
        
        if [ "$status" = "200" ] && echo "$body" | grep -q '"email":"admin@ecrf.local"'; then
            log_pass "Get current user with valid token"
        else
            log_fail "Get current user" "Status: $status"
        fi
    else
        log_skip "Get current user" "No auth token available"
    fi
    
    # Test 1.6: Get current user (unauthenticated)
    log_info "Testing /api/auth/me without token..."
    result=$(api_call "GET" "/api/auth/me" "" "" "401")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "401" ]; then
        log_pass "Get current user without token returns 401"
    else
        log_fail "Get current user without token" "Expected 401, got $status"
    fi
    
    # Test 1.7: Invalid token
    log_info "Testing with invalid/expired token..."
    result=$(api_call "GET" "/api/auth/me" "" "invalid_token_12345" "401")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "401" ]; then
        log_pass "Invalid token returns 401"
    else
        log_fail "Invalid token" "Expected 401, got $status"
    fi
    
    # Test 1.8: Different user roles
    log_info "Testing login with different roles..."
    for role_email in "pi@hospital1.local" "crc@hospital1.local" "cra@sponsor.local" "dm@sponsor.local"; do
        result=$(api_call "POST" "/api/auth/login" "{\"email\":\"$role_email\",\"password\":\"Test1234!\"}" "" "200")
        status=$(echo "$result" | cut -d'|' -f1)
        
        if [ "$status" = "200" ]; then
            log_pass "Login as $role_email"
        else
            log_fail "Login as $role_email" "Status: $status"
        fi
    done
}

# =====================================================
# 2. FUNCTIONAL TESTS - STUDY/SITE/SUBJECT
# =====================================================

test_study_crud() {
    log_section "2. FUNCTIONAL TESTS - STUDY/SITE/SUBJECT"
    
    if [ -z "$AUTH_TOKEN" ]; then
        log_skip "Study CRUD tests" "No auth token"
        return
    fi
    
    # Test 2.1: Get studies list
    log_info "Testing GET /api/studies..."
    result=$(api_call "GET" "/api/studies" "" "$AUTH_TOKEN" "200")
    status=$(echo "$result" | cut -d'|' -f1)
    body=$(echo "$result" | cut -d'|' -f2-)
    
    if [ "$status" = "200" ] && echo "$body" | grep -q '"success":true'; then
        log_pass "Get studies list"
        STUDY_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
        export STUDY_ID
    else
        log_fail "Get studies list" "Status: $status"
    fi
    
    # Test 2.2: Get single study
    if [ -n "$STUDY_ID" ]; then
        log_info "Testing GET /api/studies/:id..."
        result=$(api_call "GET" "/api/studies/$STUDY_ID" "" "$AUTH_TOKEN" "200")
        status=$(echo "$result" | cut -d'|' -f1)
        
        if [ "$status" = "200" ]; then
            log_pass "Get single study"
        else
            log_fail "Get single study" "Status: $status"
        fi
    fi
    
    # Test 2.3: Get study sites
    if [ -n "$STUDY_ID" ]; then
        log_info "Testing GET /api/studies/:id/sites..."
        result=$(api_call "GET" "/api/studies/$STUDY_ID/sites" "" "$AUTH_TOKEN" "200")
        status=$(echo "$result" | cut -d'|' -f1)
        body=$(echo "$result" | cut -d'|' -f2-)
        
        if [ "$status" = "200" ]; then
            log_pass "Get study sites"
            SITE_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
            export SITE_ID
        else
            log_fail "Get study sites" "Status: $status"
        fi
    fi
    
    # Test 2.4: Get site details
    if [ -n "$SITE_ID" ]; then
        log_info "Testing GET /api/sites/:id..."
        result=$(api_call "GET" "/api/sites/$SITE_ID" "" "$AUTH_TOKEN" "200")
        status=$(echo "$result" | cut -d'|' -f1)
        
        if [ "$status" = "200" ]; then
            log_pass "Get site details"
        else
            log_fail "Get site details" "Status: $status"
        fi
    fi
    
    # Test 2.5: Get site subjects
    if [ -n "$SITE_ID" ]; then
        log_info "Testing GET /api/sites/:id/subjects..."
        result=$(api_call "GET" "/api/sites/$SITE_ID/subjects" "" "$AUTH_TOKEN" "200")
        status=$(echo "$result" | cut -d'|' -f1)
        body=$(echo "$result" | cut -d'|' -f2-)
        
        if [ "$status" = "200" ]; then
            log_pass "Get site subjects"
            SUBJECT_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
            export SUBJECT_ID
        else
            log_fail "Get site subjects" "Status: $status"
        fi
    fi
    
    # Test 2.6: Get non-existent study
    log_info "Testing GET /api/studies/nonexistent..."
    result=$(api_call "GET" "/api/studies/nonexistent_id_12345" "" "$AUTH_TOKEN" "404")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "404" ] || [ "$status" = "403" ]; then
        log_pass "Get non-existent study returns 404/403"
    else
        log_fail "Get non-existent study" "Expected 404/403, got $status"
    fi
}

# =====================================================
# 3. BOUNDARY VALUE TESTS
# =====================================================

test_boundary_values() {
    log_section "3. BOUNDARY VALUE TESTS"
    
    if [ -z "$AUTH_TOKEN" ]; then
        log_skip "Boundary value tests" "No auth token"
        return
    fi
    
    # Test 3.1: Empty string input
    log_info "Testing empty email..."
    result=$(api_call "POST" "/api/auth/login" '{"email":"","password":"Test1234!"}' "" "400")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "400" ] || [ "$status" = "401" ]; then
        log_pass "Empty email returns error"
    else
        log_fail "Empty email" "Expected 400/401, got $status"
    fi
    
    # Test 3.2: Very long string (10000 chars)
    log_info "Testing very long email (10000 chars)..."
    long_string=$(printf 'a%.0s' {1..10000})
    result=$(api_call "POST" "/api/auth/login" "{\"email\":\"${long_string}@test.com\",\"password\":\"Test1234!\"}" "" "400")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "400" ] || [ "$status" = "401" ] || [ "$status" = "413" ]; then
        log_pass "Very long email rejected"
    else
        log_fail "Very long email" "Expected rejection, got $status"
    fi
    
    # Test 3.3: Special characters in input
    log_info "Testing special characters in password..."
    result=$(api_call "POST" "/api/auth/login" '{"email":"admin@ecrf.local","password":"Test!@#$%^&*()_+-=[]{}|;:,.<>?"}' "" "401")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "401" ]; then
        log_pass "Special characters handled correctly"
    else
        log_fail "Special characters" "Expected 401, got $status"
    fi
    
    # Test 3.4: Unicode characters
    log_info "Testing unicode in input..."
    result=$(api_call "POST" "/api/auth/login" '{"email":"테스트@ecrf.local","password":"Test1234!"}' "" "401")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "401" ] || [ "$status" = "400" ]; then
        log_pass "Unicode characters handled"
    else
        log_fail "Unicode characters" "Expected 400/401, got $status"
    fi
    
    # Test 3.5: Pagination limits
    log_info "Testing pagination with limit=0..."
    result=$(api_call "GET" "/api/studies?limit=0" "" "$AUTH_TOKEN" "200")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "200" ] || [ "$status" = "400" ]; then
        log_pass "Pagination limit=0 handled"
    else
        log_fail "Pagination limit=0" "Status: $status"
    fi
    
    # Test 3.6: Negative offset
    log_info "Testing pagination with negative offset..."
    result=$(api_call "GET" "/api/studies?offset=-1" "" "$AUTH_TOKEN" "200")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "200" ] || [ "$status" = "400" ]; then
        log_pass "Negative offset handled"
    else
        log_fail "Negative offset" "Status: $status"
    fi
    
    # Test 3.7: Very large limit
    log_info "Testing pagination with limit=999999..."
    result=$(api_call "GET" "/api/studies?limit=999999" "" "$AUTH_TOKEN" "200")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "200" ]; then
        log_pass "Very large limit handled"
    else
        log_fail "Very large limit" "Status: $status"
    fi
}

# =====================================================
# 4. NEGATIVE TESTS
# =====================================================

test_negative_cases() {
    log_section "4. NEGATIVE TESTS"
    
    # Test 4.1: Invalid HTTP methods
    log_info "Testing invalid HTTP method on login..."
    result=$(api_call "DELETE" "/api/auth/login" "" "" "405")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "404" ] || [ "$status" = "405" ]; then
        log_pass "Invalid HTTP method rejected"
    else
        log_fail "Invalid HTTP method" "Expected 404/405, got $status"
    fi
    
    # Test 4.2: Invalid JSON body
    log_info "Testing malformed JSON..."
    result=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/auth/login" -H "Content-Type: application/json" -d '{invalid json}' 2>/dev/null)
    status=$(echo "$result" | tail -n1)
    
    if [ "$status" = "400" ] || [ "$status" = "500" ]; then
        log_pass "Malformed JSON rejected"
    else
        log_fail "Malformed JSON" "Expected 400/500, got $status"
    fi
    
    # Test 4.3: Missing Content-Type
    log_info "Testing missing Content-Type header..."
    result=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/auth/login" -d '{"email":"admin@ecrf.local","password":"Test1234!"}' 2>/dev/null)
    status=$(echo "$result" | tail -n1)
    
    # Should still work or return proper error
    if [ "$status" = "200" ] || [ "$status" = "400" ] || [ "$status" = "415" ]; then
        log_pass "Missing Content-Type handled"
    else
        log_fail "Missing Content-Type" "Status: $status"
    fi
    
    # Test 4.4: Access without permission (CRA trying to write)
    log_info "Testing CRA write permission..."
    # Login as CRA
    result=$(api_call "POST" "/api/auth/login" '{"email":"cra@sponsor.local","password":"Test1234!"}' "" "200")
    CRA_TOKEN=$(echo "$result" | cut -d'|' -f2- | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    
    if [ -n "$CRA_TOKEN" ] && [ -n "$STUDY_ID" ]; then
        # CRA should not be able to create study
        result=$(api_call "POST" "/api/studies" '{"protocol_number":"TEST-001","title":"Test Study"}' "$CRA_TOKEN" "403")
        status=$(echo "$result" | cut -d'|' -f1)
        
        if [ "$status" = "403" ]; then
            log_pass "CRA cannot create study (403)"
        else
            log_fail "CRA write restriction" "Expected 403, got $status"
        fi
    else
        log_skip "CRA write permission" "Missing token or study ID"
    fi
    
    # Test 4.5: Non-existent endpoint
    log_info "Testing non-existent endpoint..."
    result=$(api_call "GET" "/api/nonexistent" "" "$AUTH_TOKEN" "404")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "404" ]; then
        log_pass "Non-existent endpoint returns 404"
    else
        log_fail "Non-existent endpoint" "Expected 404, got $status"
    fi
}

# =====================================================
# 5. SECURITY TESTS - SQL INJECTION
# =====================================================

test_sql_injection() {
    log_section "5. SECURITY TESTS - SQL INJECTION"
    
    # Test 5.1: SQL injection in email
    log_info "Testing SQL injection in email field..."
    payloads=(
        "admin@ecrf.local' OR '1'='1"
        "admin@ecrf.local'; DROP TABLE users;--"
        "admin@ecrf.local' UNION SELECT * FROM users--"
        "' OR 1=1--"
        "1; SELECT * FROM users"
        "admin@ecrf.local'/*"
    )
    
    for payload in "${payloads[@]}"; do
        result=$(api_call "POST" "/api/auth/login" "{\"email\":\"$payload\",\"password\":\"Test1234!\"}" "" "401")
        status=$(echo "$result" | cut -d'|' -f1)
        body=$(echo "$result" | cut -d'|' -f2-)
        
        # Should not return 200 or expose data
        if [ "$status" != "200" ] && ! echo "$body" | grep -qi "syntax\|error\|sql\|table"; then
            log_pass "SQL injection blocked: ${payload:0:30}..."
        else
            log_fail "SQL injection" "Payload may have affected: $payload"
        fi
    done
    
    # Test 5.2: SQL injection in query parameters
    if [ -n "$AUTH_TOKEN" ]; then
        log_info "Testing SQL injection in query parameters..."
        result=$(api_call "GET" "/api/studies?status=ACTIVE'%20OR%201=1--" "" "$AUTH_TOKEN" "200")
        status=$(echo "$result" | cut -d'|' -f1)
        
        if [ "$status" = "200" ] || [ "$status" = "400" ]; then
            log_pass "SQL injection in query params handled"
        else
            log_fail "SQL injection in query params" "Status: $status"
        fi
    fi
}

# =====================================================
# 6. SECURITY TESTS - XSS
# =====================================================

test_xss() {
    log_section "6. SECURITY TESTS - XSS"
    
    if [ -z "$AUTH_TOKEN" ]; then
        log_skip "XSS tests" "No auth token"
        return
    fi
    
    # Test 6.1: XSS in input fields
    log_info "Testing XSS payloads..."
    xss_payloads=(
        "<script>alert('xss')</script>"
        "<img src=x onerror=alert('xss')>"
        "javascript:alert('xss')"
        "<svg onload=alert('xss')>"
        "'\"><script>alert(String.fromCharCode(88,83,83))</script>"
        "<body onload=alert('xss')>"
    )
    
    for payload in "${xss_payloads[@]}"; do
        # Test in login
        result=$(api_call "POST" "/api/auth/login" "{\"email\":\"$payload\",\"password\":\"test\"}" "" "401")
        body=$(echo "$result" | cut -d'|' -f2-)
        
        # Response should not contain unescaped script tags
        if ! echo "$body" | grep -q "<script>"; then
            log_pass "XSS blocked/escaped: ${payload:0:30}..."
        else
            log_fail "XSS" "Unescaped script in response: $payload"
        fi
    done
    
    # Test 6.2: Check security headers
    log_info "Checking XSS protection headers..."
    headers=$(curl -s -I "${BASE_URL}/api/health")
    
    if echo "$headers" | grep -qi "x-xss-protection: 1"; then
        log_pass "X-XSS-Protection header present"
    else
        log_fail "X-XSS-Protection" "Header missing or incorrect"
    fi
    
    if echo "$headers" | grep -qi "x-content-type-options: nosniff"; then
        log_pass "X-Content-Type-Options header present"
    else
        log_fail "X-Content-Type-Options" "Header missing"
    fi
    
    if echo "$headers" | grep -qi "content-security-policy"; then
        log_pass "Content-Security-Policy header present"
    else
        log_fail "Content-Security-Policy" "Header missing"
    fi
}

# =====================================================
# 7. RATE LIMITING / DDoS PROTECTION
# =====================================================

test_rate_limiting() {
    log_section "7. RATE LIMITING / DDoS PROTECTION"
    
    # Test 7.1: Check rate limit headers
    log_info "Checking rate limit headers..."
    headers=$(curl -s -I "${BASE_URL}/api/health")
    
    if echo "$headers" | grep -qi "x-ratelimit-limit"; then
        log_pass "X-RateLimit-Limit header present"
    else
        log_fail "X-RateLimit-Limit" "Header missing"
    fi
    
    if echo "$headers" | grep -qi "x-ratelimit-remaining"; then
        log_pass "X-RateLimit-Remaining header present"
    else
        log_fail "X-RateLimit-Remaining" "Header missing"
    fi
    
    # Test 7.2: Login rate limiting (5 attempts per 15 min)
    log_info "Testing login rate limiting..."
    for i in {1..7}; do
        result=$(api_call "POST" "/api/auth/login" '{"email":"ratelimit@test.local","password":"wrongpassword"}' "" "")
        status=$(echo "$result" | cut -d'|' -f1)
        
        if [ "$status" = "429" ]; then
            log_pass "Login rate limit triggered after $i attempts"
            break
        fi
        
        if [ $i -eq 7 ]; then
            log_fail "Login rate limiting" "429 not returned after 7 attempts"
        fi
    done
    
    # Test 7.3: API rate limiting (100 requests per minute)
    log_info "Testing API rate limiting (sending 105 requests)..."
    rate_limit_hit=false
    
    for i in {1..105}; do
        result=$(curl -s -w "%{http_code}" -o /dev/null "${BASE_URL}/api/health" 2>/dev/null)
        if [ "$result" = "429" ]; then
            log_pass "API rate limit triggered after $i requests"
            rate_limit_hit=true
            break
        fi
    done
    
    if [ "$rate_limit_hit" = false ]; then
        log_fail "API rate limiting" "429 not returned after 105 requests (may be okay if limit > 100)"
    fi
}

# =====================================================
# 8. PERFORMANCE TESTS
# =====================================================

test_performance() {
    log_section "8. PERFORMANCE TESTS"
    
    # Test 8.1: Response time for health check
    log_info "Testing health check response time..."
    start_time=$(date +%s%N)
    curl -s "${BASE_URL}/api/health" > /dev/null
    end_time=$(date +%s%N)
    duration_ms=$(( (end_time - start_time) / 1000000 ))
    
    if [ $duration_ms -lt 2000 ]; then
        log_pass "Health check response time: ${duration_ms}ms (< 2000ms)"
    else
        log_fail "Health check response time" "${duration_ms}ms (> 2000ms)"
    fi
    
    # Test 8.2: Response time for authenticated request
    if [ -n "$AUTH_TOKEN" ]; then
        log_info "Testing authenticated request response time..."
        start_time=$(date +%s%N)
        curl -s -H "Authorization: Bearer $AUTH_TOKEN" "${BASE_URL}/api/studies" > /dev/null
        end_time=$(date +%s%N)
        duration_ms=$(( (end_time - start_time) / 1000000 ))
        
        if [ $duration_ms -lt 3000 ]; then
            log_pass "Authenticated request response time: ${duration_ms}ms (< 3000ms)"
        else
            log_fail "Authenticated request response time" "${duration_ms}ms (> 3000ms)"
        fi
    fi
    
    # Test 8.3: Concurrent requests
    log_info "Testing concurrent requests (10 parallel)..."
    start_time=$(date +%s%N)
    for i in {1..10}; do
        curl -s "${BASE_URL}/api/health" > /dev/null &
    done
    wait
    end_time=$(date +%s%N)
    duration_ms=$(( (end_time - start_time) / 1000000 ))
    
    if [ $duration_ms -lt 5000 ]; then
        log_pass "10 concurrent requests: ${duration_ms}ms total"
    else
        log_fail "Concurrent requests" "${duration_ms}ms (> 5000ms)"
    fi
}

# =====================================================
# 9. EDGE CASES
# =====================================================

test_edge_cases() {
    log_section "9. EDGE CASES"
    
    # Test 9.1: Request with extra fields
    log_info "Testing request with extra/unknown fields..."
    result=$(api_call "POST" "/api/auth/login" '{"email":"admin@ecrf.local","password":"Test1234!","extra_field":"should_be_ignored","nested":{"object":true}}' "" "200")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "200" ]; then
        log_pass "Extra fields ignored gracefully"
    else
        log_fail "Extra fields" "Status: $status"
    fi
    
    # Test 9.2: Null values
    log_info "Testing null values in request..."
    result=$(api_call "POST" "/api/auth/login" '{"email":null,"password":"Test1234!"}' "" "400")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "400" ] || [ "$status" = "401" ]; then
        log_pass "Null values handled"
    else
        log_fail "Null values" "Expected 400/401, got $status"
    fi
    
    # Test 9.3: Array instead of string
    log_info "Testing array instead of string..."
    result=$(api_call "POST" "/api/auth/login" '{"email":["admin@ecrf.local"],"password":"Test1234!"}' "" "400")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "400" ] || [ "$status" = "401" ]; then
        log_pass "Array type mismatch handled"
    else
        log_fail "Array type mismatch" "Expected 400/401, got $status"
    fi
    
    # Test 9.4: Number instead of string
    log_info "Testing number instead of string..."
    result=$(api_call "POST" "/api/auth/login" '{"email":12345,"password":"Test1234!"}' "" "400")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "400" ] || [ "$status" = "401" ]; then
        log_pass "Number type mismatch handled"
    else
        log_fail "Number type mismatch" "Expected 400/401, got $status"
    fi
    
    # Test 9.5: Case sensitivity in email
    log_info "Testing case sensitivity in email..."
    result=$(api_call "POST" "/api/auth/login" '{"email":"ADMIN@ECRF.LOCAL","password":"Test1234!"}' "" "200")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "200" ] || [ "$status" = "401" ]; then
        log_pass "Email case sensitivity handled (got $status)"
    else
        log_fail "Email case sensitivity" "Status: $status"
    fi
    
    # Test 9.6: Trailing/leading whitespace
    log_info "Testing whitespace in email..."
    result=$(api_call "POST" "/api/auth/login" '{"email":" admin@ecrf.local ","password":"Test1234!"}' "" "")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "200" ] || [ "$status" = "401" ]; then
        log_pass "Whitespace in email handled (got $status)"
    else
        log_fail "Whitespace handling" "Status: $status"
    fi
    
    # Test 9.7: Empty request body
    log_info "Testing empty request body..."
    result=$(api_call "POST" "/api/auth/login" '' "" "400")
    status=$(echo "$result" | cut -d'|' -f1)
    
    if [ "$status" = "400" ] || [ "$status" = "401" ]; then
        log_pass "Empty request body handled"
    else
        log_fail "Empty request body" "Expected 400/401, got $status"
    fi
    
    # Test 9.8: Request ID tracking
    log_info "Testing request ID in response..."
    headers=$(curl -s -I "${BASE_URL}/api/health")
    
    if echo "$headers" | grep -qi "x-request-id"; then
        log_pass "X-Request-ID header present in response"
    else
        log_fail "X-Request-ID" "Header missing"
    fi
}

# =====================================================
# GENERATE REPORT
# =====================================================

generate_report() {
    log_section "TEST RESULTS SUMMARY"
    
    echo ""
    echo -e "${GREEN}PASSED: $PASS${NC}"
    echo -e "${RED}FAILED: $FAIL${NC}"
    echo -e "${YELLOW}SKIPPED: $SKIP${NC}"
    echo ""
    
    total=$((PASS + FAIL + SKIP))
    if [ $total -gt 0 ]; then
        pass_rate=$(echo "scale=2; $PASS * 100 / $total" | bc)
        echo "Pass Rate: ${pass_rate}%"
    fi
    
    # Save detailed results to JSON
    echo "[" > "$TEST_RESULTS_FILE"
    printf '%s\n' "${TEST_RESULTS[@]}" | paste -sd, >> "$TEST_RESULTS_FILE"
    echo "]" >> "$TEST_RESULTS_FILE"
    
    echo ""
    echo "Detailed results saved to: $TEST_RESULTS_FILE"
    
    # Return exit code based on failures
    if [ $FAIL -gt 0 ]; then
        exit 1
    fi
}

# =====================================================
# MAIN EXECUTION
# =====================================================

main() {
    echo ""
    echo "=============================================="
    echo "  eCRF PWA - QA Test Suite"
    echo "  Target: $BASE_URL"
    echo "  Date: $(date)"
    echo "=============================================="
    
    test_auth
    test_study_crud
    test_boundary_values
    test_negative_cases
    test_sql_injection
    test_xss
    test_rate_limiting
    test_performance
    test_edge_cases
    
    generate_report
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi

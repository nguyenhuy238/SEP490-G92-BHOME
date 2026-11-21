# CAPSTONE PROJECT REPORT — BHOME

## SMART BOARDING HOUSE CHAIN MANAGEMENT AND OPERATIONS PLATFORM

### EXECUTION WORKFLOW & DETAILED SPECIFICATION FOR 16 LOGIN TEST CASES

**Reference Document**: Report 5.1 (Unit Test) — Sheet **`Login`** (GID: `1100883013`)  
**Target Under Test**: `LoginService.LoginAsync(userName, password, cancellationToken, device)`  
**Requirement Baseline**: SRS v1.3 (`FE-02: Identity & Access Control`, `UC-01: Sign In`, `GBR-01: Fixed 3 Roles`, `NFR 2.3: Security`)  
**Test Levels**: Unit Test (Report 5.1) & API Integration Test (Report 5.2)  
**Standard**: IEEE 829 / ISTQB Standard for Software Test Documentation  
**Author**: Test Lead (SEP490-G92 Team) — November 2026

---

## 1. OVERVIEW & TRACEABILITY MATRIX

All 16 test cases in the `Login` test specification are strictly categorized according to ISTQB standards:

- **Normal Cases**: 2 test cases (`UTC001`, `UTC002`).
- **Abnormal Cases**: 10 test cases (`UTC003`..`UTC005`, `UTC010`..`UTC016`).
- **Boundary Cases**: 4 test cases (`UTC006`..`UTC009`).

### Traceability Matrix for the 16 Test Cases:

| No  |   TC ID    | Classification | Test Objective                                                               |   Test Layer    | Execution Status  |
| :-: | :--------: | :------------: | :--------------------------------------------------------------------------- | :-------------: | :---------------: |
|  1  | **UTC001** |     Normal     | Successful Staff login; deduplicates roles into single `Staff` claim in JWT  | Postman / xUnit | **PASSED (100%)** |
|  2  | **UTC002** |     Normal     | Successful Owner login; forwards client device metadata (`device`)           | Postman / xUnit | **PASSED (100%)** |
|  3  | **UTC003** |    Abnormal    | Validation rejection when identity field `userName / email = null`           | Postman / xUnit | **PASSED (100%)** |
|  4  | **UTC004** |    Abnormal    | Validation rejection when `userName / email` contains only whitespace        | Postman / xUnit | **PASSED (100%)** |
|  5  | **UTC005** |    Abnormal    | Validation rejection when `password = ""` (empty string)                     | Postman / xUnit | **PASSED (100%)** |
|  6  | **UTC006** |    Boundary    | Upper boundary validation: `email` at exact maximum of 256 characters        |      xUnit      | **PASSED (100%)** |
|  7  | **UTC007** |    Boundary    | Boundary exceeded: `email` at 257 characters (`MaxUserNameLength + 1`)       | Postman / xUnit | **PASSED (100%)** |
|  8  | **UTC008** |    Boundary    | Upper boundary validation: `password` at exact maximum of 1024 characters    |      xUnit      | **PASSED (100%)** |
|  9  | **UTC009** |    Boundary    | Boundary exceeded: `password` at 1025 characters (`MaxPasswordLength + 1`)   |      xUnit      | **PASSED (100%)** |
| 10  | **UTC010** |    Abnormal    | Credential rejection on wrong password; records security audit failure       | Postman / xUnit | **PASSED (100%)** |
| 11  | **UTC011** |    Abnormal    | Blocks token issuance when identity has empty identifier (`Guid.Empty`)      |      xUnit      | **PASSED (100%)** |
| 12  | **UTC012** |    Abnormal    | Blocks token issuance when account has no assigned roles (`Roles = []`)      |      xUnit      | **PASSED (100%)** |
| 13  | **UTC013** |    Abnormal    | Blocks token issuance when account has unauthorized role (`GBR-01`)          |      xUnit      | **PASSED (100%)** |
| 14  | **UTC014** |    Abnormal    | Graceful cancellation when `CancellationToken` cancelled before execution    |      xUnit      | **PASSED (100%)** |
| 15  | **UTC015** |    Abnormal    | Graceful termination when client disconnects during password verification    |      xUnit      | **PASSED (100%)** |
| 16  | **UTC016** |    Abnormal    | Handles race condition: Account deactivated between verification and session |      xUnit      | **PASSED (100%)** |

---

## 2. DETAILED TEST SPECIFICATIONS (IEEE 829 FORMAT)

### 2.1. Successful Authentication Group (Normal Cases)

#### TC-LOGIN-01 (Reference: UTC001)

- **Title**: Operational Staff Login with Role Deduplication.
- **Type**: Functional / Normal Case.
- **Objective**: Authenticate Staff account; if database contains duplicated role assignments, verify the system deduplicates and issues exactly one `Staff` claim in the JWT.
- **API Details**:
  - **Method**: `POST`
  - **URL**: `https://localhost:7240/api/v1/auth/login`
  - **Headers**: `Content-Type: application/json`
  - **Payload**:
    ```json
    {
      "email": "staff.dev@example.invalid",
      "password": "Bhome!Test12345",
      "device": "Postman Desktop"
    }
    ```
- **Expected Result**:
  - **HTTP Status**: `200 OK`
  - **Response Body**:
    ```json
    {
      "userId": "b4725ba6-84f3-48aa-a8be-127119101d22",
      "roles": ["Staff"],
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresAt": "2026-11-04T09:30:00+07:00",
      "sessionId": "c1d70e9b-b2de-4804-99d4-aba0b24a96ea",
      "refreshToken": "RT-...",
      "sessionExpiresAt": "2026-11-11T09:00:00+07:00"
    }
    ```
  - **Security Check**: `ISecurityAudit.LoginFailedAsync` is NEVER called; single role `Staff` in token.

---

#### TC-LOGIN-02 (Reference: UTC002)

- **Title**: Business Owner Login with Device Metadata Tracking.
- **Type**: Functional / Normal Case.
- **Objective**: Authenticate Owner account; verify client device metadata (`device`) is forwarded and recorded in the database session.
- **API Details**:
  - **Method**: `POST`
  - **URL**: `https://localhost:7240/api/v1/auth/login`
  - **Headers**: `Content-Type: application/json`
  - **Payload**:
    ```json
    {
      "email": "owner.dev@example.invalid",
      "password": "Bhome!Test12345",
      "device": "Pixel 7 - Chrome"
    }
    ```
- **Expected Result**:
  - **HTTP Status**: `200 OK`
  - **Response Body**: Contains `roles: ["Owner"]`, valid `accessToken`, `sessionId`. Database session stores `Device: "Pixel 7 - Chrome"`.

---

### 2.2. Input Validation Group (Abnormal Cases)

#### TC-LOGIN-03 (Reference: UTC003)

- **Title**: Rejection of Null/Missing Username Field.
- **Type**: Validation / Abnormal Case.
- **Objective**: Ensure the system immediately rejects requests missing the username/email field at the API validation gateway.
- **Payload**:
  ```json
  {
    "email": null,
    "password": "Bhome!Test12345"
  }
  ```
- **Expected Result**:
  - **HTTP Status**: `400 Bad Request`
  - **Response Message**: `"The Email field is required."`
  - **Security Check**: Execution halts before calling credential verification or session services.

---

#### TC-LOGIN-04 (Reference: UTC004)

- **Title**: Rejection of Whitespace-Only Username.
- **Type**: Validation / Abnormal Case.
- **Objective**: Ensure the system trims and rejects identity strings containing only whitespace.
- **Payload**:
  ```json
  {
    "email": "   ",
    "password": "Bhome!Test12345"
  }
  ```
- **Expected Result**:
  - **HTTP Status**: `400 Bad Request`
  - **Response Message**: `"The Email field is not a valid e-mail address."`

---

#### TC-LOGIN-05 (Reference: UTC005)

- **Title**: Rejection of Empty Password Field.
- **Type**: Validation / Abnormal Case.
- **Objective**: Ensure the system immediately rejects empty password submissions.
- **Payload**:
  ```json
  {
    "email": "owner.dev@example.invalid",
    "password": ""
  }
  ```
- **Expected Result**:
  - **HTTP Status**: `400 Bad Request`
  - **Response Message**: `"The Password field is required."`

---

### 2.3. String Length Boundary Group (Boundary Cases)

#### TC-LOGIN-06 (Reference: UTC006)

- **Title**: Boundary Validation: Email at Maximum Length (256 Characters).
- **Type**: Boundary Case.
- **Objective**: Verify the system accepts an identity string at the exact maximum boundary limit of 256 characters (`MaxUserNameLength`).
- **Payload**:
  ```json
  {
    "email": "user_with_exact_256_characters_email@bhome.example.invalid...",
    "password": "Bhome!Test12345"
  }
  ```
- **Expected Result**:
  - **HTTP Status**: `200 OK`
  - **Verification**: String length is accepted without truncation; JWT token issued for Tenant role.

---

#### TC-LOGIN-07 (Reference: UTC007)

- **Title**: Boundary Exceeded: Email at 257 Characters (`Max + 1`).
- **Type**: Boundary / Negative Case.
- **Objective**: Verify the system rejects input exceeding the 256-character maximum.
- **Payload**: `email` length = 257 characters.
- **Expected Result**:
  - **HTTP Status**: `400 Bad Request`
  - **Response Message**: `"The field Email must be a string with a maximum length of 256."`

---

#### TC-LOGIN-08 (Reference: UTC008)

- **Title**: Boundary Validation: Password at Maximum Length (1024 Characters).
- **Type**: Boundary Case.
- **Objective**: Verify the system accepts a password up to 1024 characters for evaluation without buffer issues.
- **Payload**: `password` length = 1024 characters.
- **Expected Result**:
  - **HTTP Status**: `401 Unauthorized` (input length accepted, invalid credential rejected).
  - **Response Message**: `"Sign-in failed."`

---

#### TC-LOGIN-09 (Reference: UTC009)

- **Title**: Boundary Exceeded: Password at 1025 Characters (`Max + 1`).
- **Type**: Boundary / Negative Case.
- **Objective**: Verify rejection of passwords exceeding 1024 characters.
- **Payload**: `password` length = 1025 characters.
- **Expected Result**:
  - **HTTP Status**: `400 Bad Request`
  - **Response Message**: `"The field Password must be a string with a maximum length of 1024."`

---

### 2.4. Credential Verification & Security Group (Abnormal Cases)

#### TC-LOGIN-10 (Reference: UTC010)

- **Title**: Rejection of Invalid Password & Zero-Knowledge Security.
- **Type**: Security / Abnormal Case.
- **Objective**: Ensure incorrect credentials return a generic message to prevent account enumeration (GBR-13).
- **Payload**:
  ```json
  {
    "email": "owner.dev@example.invalid",
    "password": "WrongPassword@2026"
  }
  ```
- **Expected Result**:
  - **HTTP Status**: `401 Unauthorized`
  - **Response Body**:
    ```json
    {
      "type": "https://tools.ietf.org/html/rfc9110#section-15.5.2",
      "title": "Sign-in failed.",
      "status": 401
    }
    ```
  - **Security Check**: Increments failed access count; records security audit entry.

---

#### TC-LOGIN-11 (Reference: UTC011)

- **Title**: Rejection of Empty User Identifier (`Guid.Empty`).
- **Type**: Data Integrity / Abnormal Case.
- **Objective**: Guard against internal database corruption where an account identity has an empty GUID (`00000000-0000-0000-0000-000000000000`).
- **Expected Result**:
  - **HTTP Status**: `401 Unauthorized`
  - **Response Message**: `"Sign-in failed."` (Session creation rejected).

---

#### TC-LOGIN-12 (Reference: UTC012)

- **Title**: Rejection of Account with No Assigned Roles (`Roles = []`).
- **Type**: Authorization / Abnormal Case.
- **Objective**: Ensure the system refuses to issue sessions for accounts with no defined system permissions.
- **Expected Result**:
  - **HTTP Status**: `401 Unauthorized` / `403 Forbidden`
  - **Response Message**: `"Sign-in failed."`

---

#### TC-LOGIN-13 (Reference: UTC013)

- **Title**: Rejection of Account with Unauthorized Roles (GBR-01 Violation).
- **Type**: RBAC Policy / Abnormal Case.
- **Objective**: Enforce GBR-01 invariant: Only exactly 3 roles `{Owner, Staff, Tenant}` are permitted. Any external/legacy roles (e.g. `Administrator`, `SuperUser`) must be strictly rejected.
- **Expected Result**:
  - **HTTP Status**: `401 Unauthorized`
  - **Response Message**: `"Sign-in failed."`

---

#### TC-LOGIN-14 (Reference: UTC014)

- **Title**: Pre-execution Client Cancellation Handling.
- **Type**: Fault Tolerance / Abnormal Case.
- **Objective**: Ensure the system handles pre-execution request cancellations gracefully via `CancellationToken`.
- **Expected Result**:
  - **Result**: Throws `OperationCanceledException` safely; no database queries executed; zero session state created.

---

#### TC-LOGIN-15 (Reference: UTC015)

- **Title**: Mid-execution Timeout / Client Disconnect Handling.
- **Type**: Fault Tolerance / Abnormal Case.
- **Objective**: Verify that client disconnections during password verification terminate the pipeline cleanly without orphan state.
- **Expected Result**:
  - **Result**: Throws `OperationCanceledException`; transaction is safely aborted; no token leaked.

---

#### TC-LOGIN-16 (Reference: UTC016)

- **Title**: Concurrent Account Deactivation Handling.
- **Type**: Concurrency / Race Condition Case.
- **Objective**: Handle the race condition where an account is active during credential verification but deactivated before session issuance.
- **Expected Result**:
  - **HTTP Status**: `401 Unauthorized`
  - **Response Message**: `"Account is inactive or locked out."`

---

## 3. STAFF ACCOUNT PROVISIONING TEST SUITE (RBAC / CAPTURE)

Based on SRS UC-08 and GBR-01..02, operational Staff accounts can only be provisioned by an authenticated Owner. Staff accounts are strictly forbidden from creating other accounts.

### TC-REG-01: Owner Provisions New Staff Account (Happy Path)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/capture/staff`
- **Headers**: `Authorization: Bearer <Token_Owner>`, `Content-Type: application/json`
- **Payload**:
  ```json
  {
    "userName": "staff_hn_new",
    "email": "staff_hn_new@example.invalid",
    "password": "Bhome!Test12345"
  }
  ```
- **Expected Status**: `200 OK`
- **Verification**: Staff account created successfully with role `Staff` assigned.

---

### TC-REG-02: Block Staff Self-Provisioning (Security / RBAC Violation)

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/capture/staff`
- **Headers**: `Authorization: Bearer <Token_Staff>`, `Content-Type: application/json`
- **Payload**: Same as TC-REG-01.
- **Expected Status**: `403 Forbidden`
- **Verification**: System blocks Staff from exceeding their authority.

---

### TC-REG-03: Block Unauthenticated Staff Creation

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/capture/staff`
- **Headers**: Missing `Authorization` header.
- **Expected Status**: `401 Unauthorized`
- **Verification**: Anonymous access strictly rejected.

---

### TC-REG-04: Reject Duplicate Username or Email

- **Method**: `POST`
- **URL**: `https://localhost:7240/api/v1/capture/staff`
- **Headers**: `Authorization: Bearer <Token_Owner>`
- **Payload**: Username/email already existing in database.
- **Expected Status**: `400 Bad Request`
- **Response Body**:
  ```json
  {
    "type": "https://httpstatuses.com/400",
    "title": "Invalid HTTP request.",
    "status": 400,
    "code": "staff_account_not_created"
  }
  ```

---

## 4. AUTOMATED EXECUTION SUMMARY

- **Test Framework**: xUnit + NSubstitute + ASP.NET Core Web API Test Engine
- **Execution Date**: 04/11/2026
- **Database Target**: PostgreSQL 16 (Compact24 Schema — 24 tables, 386 columns, 83 foreign keys)
- **Execution Results**:
  - Total Executed: **20 tests**
  - Total Passed: **20 tests (100%)**
  - Total Failed: **0 tests (0%)**
  - Execution Time: **428 ms**
  - Status: **APPROVED FOR RELEASE SPRINT 2**

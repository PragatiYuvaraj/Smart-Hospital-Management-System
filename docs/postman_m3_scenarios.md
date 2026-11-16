# Milestone 3 — Postman Integration Test Scenarios

> These HTTP tests require a **running backend** (`npm run dev`) and a **running MongoDB** instance.  
> Import the scenarios below into Postman, set your `{{base_url}}` to `http://localhost:5000`, and run them in order.

> [!IMPORTANT]
> Never commit real tokens, passwords, or the contents of your `.env` file. The examples below use placeholder values.

---

## Environment Variables (Postman)

| Variable      | Example Value                         |
|---------------|---------------------------------------|
| `base_url`    | `http://localhost:5000`               |
| `admin_token` | _(set after Step 1 login)_            |
| `doctor_id`   | _(set after Step 3 create doctor)_    |
| `pharmacy_id` | _(set after Step 4 create pharmacy)_  |
| `patient_id`  | _(set after Step 5 register patient)_ |

---

## Scenario 1 — Bootstrap + Login as CMO

**Pre-condition:** Run `npm run bootstrap` first.

```
POST {{base_url}}/api/auth/login
Body: { "email": "<cmo_email>", "password": "<cmo_password>" }
Expected: 200 OK — token in response
Action: Save token to {{admin_token}}
```

---

## Scenario 2 — Verify CMO has MANAGE_USERS

```
GET {{base_url}}/api/auth/me
Header: Authorization: Bearer {{admin_token}}
Expected: 200 OK
Check: data.user.permissions includes "MANAGE_USERS"
Check: data.user.role === "DOCTOR"
Check: data.user does NOT contain "passwordHash"
```

---

## Scenario 3 — Create DOCTOR Account (admin only)

```
POST {{base_url}}/api/users
Header: Authorization: Bearer {{admin_token}}
Body:
{
  "name": "Dr. Sarah Chen",
  "email": "sarah.chen@hospital.local",
  "password": "Doctor@2024",
  "role": "DOCTOR",
  "permissions": ["DUTY_DOCTOR"]
}
Expected: 201 Created
Check: data.user.role === "DOCTOR"
Check: data.user.permissions includes "DUTY_DOCTOR"
Check: data.user.permissions does NOT include "MANAGE_USERS"
Check: "passwordHash" is absent from response
Action: Save data.user._id to {{doctor_id}}
```

---

## Scenario 4 — Create PHARMACY Account (admin only)

```
POST {{base_url}}/api/users
Header: Authorization: Bearer {{admin_token}}
Body:
{
  "name": "MedPlus Pharmacy",
  "email": "medplus@hospital.local",
  "password": "Pharma@2024",
  "role": "PHARMACY"
}
Expected: 201 Created
Check: data.user.role === "PHARMACY"
Check: data.user.permissions.length === 0
Action: Save data.user._id to {{pharmacy_id}}
```

---

## Scenario 5 — Public Patient Registration (role override)

```
POST {{base_url}}/api/auth/register
Body:
{
  "name": "Alice Patient",
  "email": "alice@hospital.local",
  "password": "Patient@2024",
  "role": "DOCTOR"
}
Expected: 201 Created
Check: data.user.role === "PATIENT"  ← server ignores supplied role
Check: data.user.permissions.length === 0
Action: Save data.user._id to {{patient_id}}
```

---

## Scenario 6 — Duplicate Email Rejected

```
POST {{base_url}}/api/users
Header: Authorization: Bearer {{admin_token}}
Body: { "name": "...", "email": "sarah.chen@hospital.local", "password": "...", "role": "DOCTOR" }
Expected: 409 Conflict
Check: success === false
```

---

## Scenario 7 — Unauthenticated Request Blocked

```
POST {{base_url}}/api/users
(No Authorization header)
Body: { "name": "...", "email": "...", "password": "...", "role": "DOCTOR" }
Expected: 401 Unauthorized
Check: success === false
```

---

## Scenario 8 — Non-Admin Cannot Create Staff

```
POST {{base_url}}/api/users
Header: Authorization: Bearer {{doctor_token}}  ← ordinary doctor (no MANAGE_USERS)
Body: { ... }
Expected: 403 Forbidden
Check: success === false, message mentions "MANAGE_USERS"
```

---

## Scenario 9 — List Users (admin only)

```
GET {{base_url}}/api/users
Header: Authorization: Bearer {{admin_token}}
Expected: 200 OK
Check: data.users is an array
Check: data.total >= 3 (CMO + doctor + pharmacy + patient)
Check: none of the user objects contain "passwordHash"
```

---

## Scenario 10 — List Users with Filter

```
GET {{base_url}}/api/users?role=DOCTOR&status=ACTIVE
Header: Authorization: Bearer {{admin_token}}
Expected: 200 OK
Check: all items in data.users have role === "DOCTOR" and status === "ACTIVE"
```

---

## Scenario 11 — Patient Views Own Profile

```
GET {{base_url}}/api/users/{{patient_id}}
Header: Authorization: Bearer {{patient_token}}
Expected: 200 OK
Check: data.user._id === patient_id
Check: "passwordHash" absent
```

---

## Scenario 12 — Doctor Cannot View Another User's Profile

```
GET {{base_url}}/api/users/{{patient_id}}
Header: Authorization: Bearer {{doctor_token}}  ← no MANAGE_USERS
Expected: 403 Forbidden
```

---

## Scenario 13 — Update User Permissions

```
PATCH {{base_url}}/api/users/{{doctor_id}}/permissions
Header: Authorization: Bearer {{admin_token}}
Body: { "permissions": ["DUTY_DOCTOR", "VAULT_ACCESS"] }
Expected: 200 OK
Check: data.user.permissions includes "DUTY_DOCTOR" and "VAULT_ACCESS"
Check: data.user.permissions does NOT include "MANAGE_USERS"
```

---

## Scenario 14 — Block MANAGE_USERS Grant via Endpoint

```
PATCH {{base_url}}/api/users/{{doctor_id}}/permissions
Header: Authorization: Bearer {{admin_token}}
Body: { "permissions": ["MANAGE_USERS"] }
Expected: 400 Bad Request
Check: success === false, message mentions "MANAGE_USERS"
```

---

## Scenario 15 — Block Clinical Permissions on PHARMACY

```
PATCH {{base_url}}/api/users/{{pharmacy_id}}/permissions
Header: Authorization: Bearer {{admin_token}}
Body: { "permissions": ["DUTY_DOCTOR"] }
Expected: 400 Bad Request
Check: success === false, message mentions "PHARMACY"
```

---

## Scenario 16 — Deactivate a User

```
PATCH {{base_url}}/api/users/{{doctor_id}}/status
Header: Authorization: Bearer {{admin_token}}
Body: { "status": "INACTIVE" }
Expected: 200 OK
Check: data.user.status === "INACTIVE"
```

---

## Scenario 17 — Deactivated User Cannot Login

```
POST {{base_url}}/api/auth/login
Body: { "email": "sarah.chen@hospital.local", "password": "Doctor@2024" }
Expected: 401 Unauthorized
Check: success === false, message mentions inactive or account
```

---

## Scenario 18 — Admin Cannot Self-Deactivate

```
PATCH {{base_url}}/api/users/{{cmo_id}}/status
Header: Authorization: Bearer {{admin_token}}
Body: { "status": "INACTIVE" }
Expected: 400 Bad Request
Check: success === false, message mentions "own account"
```

---

## Scenario 19 — Admin Cannot Self-Modify Permissions

```
PATCH {{base_url}}/api/users/{{cmo_id}}/permissions
Header: Authorization: Bearer {{admin_token}}
Body: { "permissions": ["DUTY_DOCTOR"] }
Expected: 400 Bad Request
Check: success === false, message mentions "own permissions"
```

---

## Scenario 20 — Reactivate User

```
PATCH {{base_url}}/api/users/{{doctor_id}}/status
Header: Authorization: Bearer {{admin_token}}
Body: { "status": "ACTIVE" }
Expected: 200 OK
Check: data.user.status === "ACTIVE"
```

---

## Notes

- Always verify **`passwordHash` is absent** from every response that includes a user object.
- The bootstrap script must be run **before** any admin API calls are possible.
- All 5 user management endpoints return `{ success, message, data }` consistently.

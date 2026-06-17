# Auth & User-Scoped Tests Design

## Goal
Give each teacher their own private pool of tests, add sign-up to the login page, make the nav hide Grade/Results until authenticated, and ensure the database loads tests reliably.

## Architecture

React `AuthProvider` context holds the current user. Every page and the nav reads from it. The backend adds `userId` to the `Test` model so all test queries are scoped to the logged-in teacher. Registration auto-confirms accounts so no email service is needed.

## Tech Stack
- Backend: Node/Express/TypeScript, Mongoose 8, existing `/v1/user/me` + `/v1/logout` endpoints
- Frontend: Next.js 15 App Router, React context, Tailwind CSS
- Auth cookies: HttpOnly, set by backend on login

---

## Backend Changes

### 1. Registration — auto-confirm + optional phone number

**`src/APIs/user/authentication/validation/validation.schema.ts`**
- Make `phoneNumber` optional: `joi.string().optional()`

**`src/APIs/user/authentication/types/authentication.interface.ts`**
- `IRegisterRequest.phoneNumber?: string`

**`src/APIs/user/_shared/types/users.interface.ts`**
- `phoneNumber` object fields all optional
- `timezone?: string`

**`src/APIs/user/_shared/models/user.model.ts`**
- `phoneNumber.isoCode`, `countryCode`, `internationalNumber`: remove `required: true`
- `timezone`: remove `required: true`, add `default: ''`

**`src/APIs/user/authentication/authentication.service.ts`**
- If `phoneNumber` is absent, skip `parsePhoneNumber` and use `{ isoCode: '', countryCode: '', internationalNumber: '' }` with timezone `'UTC'`
- Set `accountConfirmation.status = true` at creation time (skip email confirmation)
- Remove the confirmation email send block

### 2. User-scoped tests

**`src/APIs/exam/types/exam.interface.ts`**
- Add `userId: mongoose.Types.ObjectId | string` to `ITest`

**`src/APIs/exam/test.model.ts`**
- Add `userId: { type: ObjectId, ref: 'User', required: true }`

**`src/APIs/exam/test.repository.ts`**
All methods gain a `userId: string` parameter:
- `create(name, userId)` — sets userId on the new doc
- `findById(id, userId)` — adds `{ _id: id, userId }` to the query so teachers can't access each other's tests
- `listWithCounts(userId)` — filters `TestModel.find({ userId })`
- `getResults(testId, userId)` — verifies ownership with `{ _id: testId, userId }`

**`src/APIs/exam/exam.service.ts`**
- `gradeExamFiles(answerKeyBuffer, studentPaperBuffer, mode, studentName, userId, testId?, testName?)`
- `resolveTestId(testId, testName, userId)` — passes userId to create/findById
- `listTests(userId)` — passes userId to repository
- `getTestResults(testId, userId)` — passes userId to repository

**`src/types/types.ts`**
- Change `IAuthenticateRequest.authenticatedUser` from `IUser` to `IUserWithId` so `._id` is accessible in controllers

**`src/APIs/exam/exam.controller.ts`**
- Extract `userId = (request as IAuthenticateRequest).authenticatedUser._id.toString()` in all handlers
- Pass to service calls

---

## Frontend Changes

### 1. Auth context

**New file: `frontend/src/context/auth.tsx`**
```typescript
'use client'
interface AuthUser { _id: string; name: string; email: string }
interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  login: (user: AuthUser) => void
  logout: () => void
}
```
- `AuthProvider` calls `GET /v1/user/me` on mount. On 200 → `setUser`. On 401 → `user = null`.
- `login(user)` updates state — called after successful sign-in/sign-up
- `logout()` calls `PUT /v1/logout`, sets `user = null`, then `window.location.href = '/login'`
- Export `useAuth()` hook that throws if used outside provider

### 2. Root layout

**`frontend/src/app/layout.tsx`**
- Wrap `{children}` with `<AuthProvider>`
- Replace the static `<nav>` with `<ClientNav />`

### 3. Auth-aware nav

**New file: `frontend/src/components/ClientNav.tsx`**
```
loading = true  →  logo only
user = null     →  logo  |  Sign In
user set        →  logo  |  Grade  |  Results  |  {user.name}  |  Logout
```
- `Logout` button calls `logout()` from `useAuth()`
- All links use Next.js `<Link>`

### 4. Login page — tabbed sign in / sign up

**`frontend/src/app/login/page.tsx`**
- Two tabs: "Sign In" and "Sign Up"
- Sign In: email, password → `POST /v1/login` → `login(user)` from context → navigate to `/exam`
- Sign Up: name, email, password, confirm-password → `POST /v1/register` → then auto-login with same credentials → `login(user)` from context → navigate to `/exam`
- After sign-up, the auto-login calls `POST /v1/login` immediately (since account is auto-confirmed)
- Error messages shown inline below the form

### 5. Protected pages

**`frontend/src/app/exam/page.tsx`** and **`frontend/src/app/results/page.tsx`**
- Replace the `apiFetch('/v1/exam/tests')` auth-check pattern with a `useEffect` on `useAuth()`:
  ```typescript
  const { user, loading } = useAuth()
  useEffect(() => {
    if (!loading && !user) window.location.href = '/login'
  }, [user, loading])
  if (loading || !user) return null
  ```
- Remove the standalone `loadTests` auth check (the context handles it)
- The `loadTests` call itself stays — it just no longer doubles as the auth guard

---

## Data Flow — Login to Grading

```
User opens app
  → AuthProvider fetches /v1/user/me
  → 401 → user = null → ClientNav shows "Sign In"
  → User navigates to /login
  → Signs in → /v1/login sets cookie
  → POST succeeds → GET /v1/user/me → login(user) updates context
  → Navigate to /exam
  → ClientNav now shows Grade | Results | Logout
  → /exam loadTests fetches /v1/exam/tests?userId scoped
  → Tests load correctly
```

---

## Error Handling
- `/v1/register` 409 (email taken) → "An account with that email already exists"
- `/v1/login` 400/404 → "Invalid email or password"
- Sign-up password mismatch → client-side validation before submit
- Auth context 401 → redirect to `/login` (same as today)

---

## Testing
- Backend: add `userId` to existing exam test fixtures; update `test-management.spec.ts` to pass userId
- Frontend: no automated tests (visual verification sufficient for UI changes)

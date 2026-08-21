# Product Requirements Document (PRD) - Biztrack

> ⚠️ **Historical document — the technical sections are out of date.**
>
> This PRD was written against the original Firebase implementation. Biztrack now
> runs entirely on AWS: **Cognito** for auth, **DynamoDB** for data, Lambda, API
> Gateway and S3/CloudFront. The Firebase project was deleted on 2026-08-07.
>
> Every mention below of Firebase Auth, Firestore, Firestore listeners, Firestore
> Security Rules or Cloud Functions describes the **old** implementation and must
> not be used as a guide to how the app works today.
>
> The *product* requirements — sections 1 to 7 — are still accurate and still the
> intent. For current architecture, data model and decisions, read
> [`docs/PROJECT.md`](docs/PROJECT.md), which is the authoritative source.

## 1. Overview & Objectives

### 1.1 Purpose of the Application
Biztrack is a comprehensive business management dashboard designed for independent business owners, supervisors, and network marketers. It serves as a central hub for managing client relationships (CRM), tracking daily tasks, visualizing organizational structures, and scheduling follow-ups.

### 1.2 Core Problems It Solves
-   **Fragmented Data:** Consolidates client lists, task managers, and calendars into one app.
-   **Follow-Up Management:** Prevents lost leads by tracking "Next Follow-Up" dates and highlighting overdue calls.
-   **Team Visualization:** Replaces manual drawing or spreadsheets with a dynamic, zoomable Organization Tree.
-   **Productivity Tracking:** Provides clear metrics on daily calls due, tasks pending, and overall database growth.

### 1.3 Target Users & Use Cases
-   **Business Owner / Supervisor:**
    -   Managing a personal database of clients (users, prospects, associates).
    -   Tracking personal daily tasks and appointments.
    -   Visualizing and editing their downline/team structure.
    -   Monitoring business growth metrics.

---

## 2. User Personas & Roles

### 2.1 User Types
The application currently supports a single primary user type with authenticated access.

*   **Registered User (Owner):** Has full read/write access to their own isolated data (Clients, Tasks, Org Tree, Profile).

### 2.2 Permissions & Access Control
-   **Authentication:** Required for all features. Handled via Firebase Auth.
-   **Data Isolation:**
    -   All data (Clients, Tasks, Org Nodes) is scoped to the `currentUser.uid` in Firestore.
    -   Users cannot access or modify another user's data.
-   **Role-Based Features:**
    -   Currently, all registered users have the same feature set.
    -   The "Business Tier" (Supervisor, World Team, President Team, etc.) is a profile attribute that may influence future features but currently serves as metadata.

---

## 3. Feature Requirements (Exhaustive)

### 3.1 Authentication & User Account
-   **Sign Up:** Create account with Email, Password, and Name. Auto-creates a user profile in Firestore.
-   **Log In:** Access account with Email/Password. Supports "Remember Me" (Local vs. Session persistence).
-   **Google Sign-In:** Authenticate using Google provider. Auto-provisions profile if new.
-   **Forgot Password:** Trigger Firebase password reset email.
-   **Log Out:** Securely end session.
-   **Delete Account:** Permanently remove Auth account, Firestore profile, and all sub-collections (Tasks, Clients, Org Tree). **Irreversible.**

### 3.2 Dashboard
-   **Metric Cards:**
    -   **Calls Due Currently:** Count of active clients with `nextFollowUpDate` <= Today. Color-coded (Orange if > 0).
    -   **Task Stats:** Breakdown of Overdue, Pending, and Completed tasks.
    -   **Active Clients:** Total count of non-archived clients.
-   **Outreach List (Priority):**
    -   Displays clients with calls due today/overdue.
    -   Action: "Mark Done" opens Call Outcome Modal.
-   **Priority Task List:**
    -   Displays top 5 high-priority, non-completed tasks (sorted by Priority then Date).
-   **Quick Actions:** Shortcuts to "Add Client", "Add Task", "Calendar".
-   **Recent Activity:** Lists newly added clients and recently contacted clients.

### 3.3 Client Management (CRM)
-   **Client Database:** List view of all clients with pagination (50 items/page).
-   **Filtering & Sorting:**
    -   Filter by Client Type (Prospect, User, Associate, Supervisor, etc.).
    -   Search by Name or Mobile.
    -   Sort by Name or Next Follow-Up Date.
-   **Add/Edit Client:**
    -   Fields: Name (Req), Mobile (Req), Email, Profile Image, Client Type, Status (Active/Archived), Frequency, Next Follow-Up, Notes.
-   **Client Actions:**
    -   **Call Outcome:** Log a call result (Completed, Voicemail, Wrong Number, Sale). Updates `lastContactDate` and sets new `nextFollowUpDate`.
    -   **Edit:** Modify details.
    -   **Delete:** Remove client record.
    -   **Archive:** Set status to 'Archived' (hides from active lists).
-   **Bulk Actions:**
    -   Select multiple clients.
    -   Bulk Delete.
    -   Bulk Set Status (Active/Archive).
-   **Import/Export:**
    -   **Import:** Parse Excel/CSV files. Map columns (Name, Mobile, etc.). Preview data before saving.
    -   **Export:** Download full client list as Excel.

### 3.4 Task Manager
-   **Task List:**
    -   View tasks with filters: Status (All, Pending, Completed, Overdue) and Priority (High, Medium, Low).
    -   Sort by Date or Priority.
-   **CRUD Operations:**
    -   **Add Task:** Title, Priority, Due Date, Notes.
    -   **Update Task:** Mark as Completed/Pending, Edit details.
    -   **Delete Task:** Remove task.
-   **Visuals:** Progress bar showing completion % of all tasks.

### 3.5 Calendar
-   **Month View:**
    -   Grid display of days.
    -   Indicators (Pills) for number of Tasks and Calls per day.
    -   Month/Year selector navigation.
-   **Day Details Modal:**
    -   Clicking a day opens a modal listing specific Tasks and Calls for that date.
    -   Actions: Reschedule items, Toggle task status.

### 3.6 Team (Organization Tree)
-   **Tree Visualization:** Interactive chart showing hierarchy.
    -   Root node = Current User.
    -   Children = Downline members.
-   **Zoom Controls:** Zoom In/Out/Reset.
-   **Node Management:**
    -   **Add Child:** Add a team member under a specific parent. Fields: Name, Role, Business Level.
    -   **Edit Node:** Modify Name, Role, Level.
    -   **Delete Node:** Remove a node and *all* its descendants (recursive delete).

### 3.7 User Profile
-   **Profile Editing:** Update Name, Business Level, Phone Number.
-   **Profile Photo:** Upload/Remove avatar image.
-   **Settings:**
    -   **Report Time:** Set preferred time for automated reports.
    -   **Test Report:** Trigger a test (mock functionality).
-   **Security:**
    -   Change Password (via Email reset flow).
    -   View Last Login time and Creation Date.

---

## 4. User Flows & Workflows

### 4.1 Daily Workflow (Morning Routine)
1.  **Login:** User logs in.
2.  **Dashboard Check:** User sees "Calls Due" count = 5.
3.  **Outreach:**
    *   User clicks "Call" on first client in Outreach List.
    *   User performs call (external).
    *   User returns, clicks checkmark.
    *   **Call Outcome Modal** appears.
    *   User selects outcome (e.g., "Spoke to client"), sets next follow-up date.
    *   Client is removed from "Due" list.
4.  **Task Execution:**
    *   User checks Priority Task List.
    *   Completes high-priority items.
    *   Marks them as "Completed".
5.  **Review Calendar:** Checks upcoming schedule for the week.

### 4.2 Data Import Flow
1.  Navigate to **Clients** page.
2.  Click **Import Clients**.
3.  Upload `.xlsx` file.
4.  **Preview Modal** opens, showing successfully parsed rows and errors.
5.  User reviews data.
6.  Click **Import**.
7.  Batch write to Firestore occurs. List refreshes.

---

## 5. Functional Requirements

### 5.1 Business Logic
-   **Overdue Logic:** A task/call is overdue if `date < today (00:00:00)`.
-   **Org Tree:** A node cannot be its own parent. Deleting a node must delete the entire subtree to prevent orphaned nodes.
-   **Data Sync:** Updates in one session (e.g., phone) must reflect immediately in others (e.g., laptop) using Firestore listeners.

### 5.2 Data Handling
-   **Persistence:** LocalStorage used for unsaved UI states (if any); core data persists in Firestore.
-   **Offline:** App should load with cached Firestore data if offline (if enabled in Firebase config), otherwise requires connection.
-   **Validation:**
    -   Mobile numbers must be valid format (managed by `react-phone-number-input`).
    -   Required fields (Name, Mobile) must be present.

---

## 6. Non-Functional Requirements

### 6.1 Performance
-   **Load Time:** Dashboard should render priority content (metrics) within 1.5s.
-   **List Virtualization:** (Recommended) Client lists should handle 1000+ records without scroll lag. *Current implementation uses pagination (50 items) to mitigate this.*
-   **Bulk Operations:** Bulk delete of 500 items should complete within 5s (batched).

### 6.2 Security
-   **Rules:** Firestore Security Rules must strictly enforce `request.auth.uid == userId` for all paths.
-   **Inputs:** All inputs sanitized (React default).
-   **Secrets:** API keys (Firebase config) are public-safe; sensitive logic (if any) should be in Cloud Functions (none currently).

### 6.3 Reliability
-   **Error Handling:** Failed network requests should trigger user-friendly alerts/toasts (e.g., "Failed to save").
-   **Conflict Resolution:** Last-write-wins strategy for concurrent edits on same document.

---

## 7. UI / UX Requirements

### 7.1 Visual Design
-   **Framework:** Tailwind CSS.
-   **Theme:** Clean, modern SaaS aesthetic. White/Slate background, Blue primary actions.
-   **Responsiveness:**
    -   **Mobile:** Stacked layouts, bottom sheets (month selector), hamburger menus (if applicable).
    -   **Desktop:** Sidebar navigation (implied layout), Grid layouts (3-col dashboard), Modal centers.

### 7.2 Accessibility
-   **ARIA:** Buttons and Inputs should have labels.
-   **Focus:** Modals should trap focus.
-   **Contrast:** Text should meet WCAG AA standards (Slate-500/Slate-900 usually sufficient).

---

## 8. Data Model & Integrations

### 8.1 Data Entities (Firestore)
*   **User (`users/{uid}`)**: `name`, `email`, `level`, `phoneNumber`, `photoURL`, `avatarColor`.
*   **Task (`users/{uid}/tasks/{taskId}`)**: `title`, `priority`, `status`, `dueDate`, `notes`.
*   **Client (`users/{uid}/clients/{clientId}`)**: `clientName`, `mobile`, `clientType`, `status`, `nextFollowUpDate`, `notes`, `frequency`.
*   **OrgNode (`users/{uid}/orgNodes/{nodeId}`)**: `name`, `role`, `level`, `parentId`. Note: `children` computed client-side.

### 8.2 Integrations
-   **Firebase Authentication:** Identity management.
-   **Firebase Firestore:** NoSQL Database.
-   **WhatsApp:** "Click to Chat" integration using `wa.me` links for client mobile numbers.

---

## 9. Assumptions & Constraints
-   **Internet Required:** Primary functionality relies on connection to Firebase.
-   **Single Tenant per Account:** No "Team" sharing feature; "Team" page is for visualization of downline, not shared access.
-   **Max Children Depth:** Tree visualization assumes reasonable depth/breadth; extreme nesting may degrade UI performance.
-   **Mobile Parsing:** Excel import assumes standard mobile formats; extremely malformed numbers may need manual correction.

---

## 10. Acceptance Criteria

### 10.1 Core Functionality
-   [ ] User can sign up, log in, and log out successfully.
-   [ ] Creating a client appears immediately in "All Clients".
-   [ ] Creating a task with "High" priority appears in "Priority Tasks".
-   [ ] Deleting a client removes them from all lists.

### 10.2 Workflow Validation
-   [ ] "Marking Done" a call from Dashboard moves it out of "Calls Due".
-   [ ] Importing an Excel file with 50 valid rows results in 50 new client records.
-   [ ] Adding a child node in Team view correctly links it to the parent in the tree structure.

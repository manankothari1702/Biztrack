# Biztrack Application Overview

## 1. Purpose
Biztrack is a comprehensive business management application designed to help users streamline their daily operations. It acts as a central hub for managing clients, tasks, team structures, and schedules. The application aims to improve productivity and organization for business owners and supervisors by providing a unified interface for all key business data.

## 2. Key Features

### 2.1 Authentication & User Management
-   **Secure Login/Signup:** Users can securely sign up and log in to access their private data.
-   **Profile Management:** Users can view and update their profile information.
-   **Data Privacy:** All data (clients, tasks, team) is isolated per user, ensuring privacy and security.

### 2.2 Client Management (CRM)
-   **Client Database:** Maintain a detailed database of clients.
-   **CRUD Operations:** Capabilities to Add, Read, Update, and Delete client records.
-   **Bulk Actions:** Efficiently manage large lists with bulk delete and bulk import capabilities (supporting Excel import).
-   **Real-time Updates:** Client data is synchronized in real-time across devices.

### 2.3 Task Management
-   **Task Tracking:** Create and manage tasks to stay on top of to-dos.
-   **Status Updates:** Track the progress of tasks.
-   **Integration:** Tasks are linked to business activities or clients.

### 2.4 Team & Organization Management
-   **Hierarchical Structure:** Manage a team structure using an Organization Tree (Root, Supervisor, etc.).
-   **Role Management:** Define roles and levels within the organization.
-   **Visual Representation:** Visualize the team hierarchy.

### 2.5 Calendar & Scheduling
-   **Calendar View:** A dedicated view to manage schedules, appointments, or deadlines.
-   **Integration:** Integrates with tasks and client follow-ups for a cohesive schedule.

### 2.6 Dashboard
-   **Overview:** A landing page providing high-level metrics and quick access to key features.

## 3. How It Works

### 3.1 Technical Architecture
-   **Frontend:** Built with **React** and **Vite** for a fast, modern, and responsive user interface.
-   **Styling:** Uses **Tailwind CSS** for a clean, consistent, and mobile-friendly design.
-   **Routing:** Utilizes **React Router** for seamless navigation between different modules (Dashboard, Clients, Tasks, etc.).

### 3.2 Data Management (Backend)
-   **DynamoDB:** A single DynamoDB table in `ap-south-1` holds all business data, using a single-table design. Every item is partitioned by `PK = USER#<uid>`, where `uid` comes from the verified Cognito token — that partition key is the tenancy boundary.
-   **API:** API Gateway (REST) fronts one Lambda per resource (clients, tasks, products, batches, invoices, …), each behind a Cognito user-pool authorizer.
-   **Data Context:** A `DataContext` in the frontend manages data interactions and caching. Data is fetched over HTTP, not streamed — there are no real-time listeners.

### 3.3 User Workflow
1.  **Onboarding:** The user signs up and is authenticated via AWS Cognito. A PostConfirmation Lambda trigger creates their profile record.
2.  **Setup:** The user initializes their data (clients, team members).
3.  **Daily Use:** The user logs in to the Dashboard to check tasks and schedules. They navigate to the Clients page to manage customer interactions or the Team page to adjust organizational structures.
4.  **Syncing:** Any change made (e.g., adding a client) is written to DynamoDB through the API. Other open sessions pick it up on their next fetch, not instantly.

## 4. Setup & Deployment (Developer Guide)
-   **Dependencies:** Managed via `npm` (React, AWS Amplify auth, Tailwind, ExcelJS, etc.).
-   **Scripting:**
    -   `npm run dev`: Starts the local development server.
    -   `npm run build`: Compiles the application for production.
-   **Deployment:** `cd lambda && npm run build`, then `cd infra && npx cdk deploy`. The frontend is built to `dist/` and served from S3 behind CloudFront; the API and all AWS resources are defined in CDK.
-   **Standard:** This project follows the company AI Engineering Operating System (`.ai-eos/`). See `docs/PROJECT.md` for identity, algorithms and deliberate deviations.

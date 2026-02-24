# Biztrack

Biztrack is a comprehensive business management dashboard designed for independent business owners, supervisors, and network marketers. It serves as a central hub for managing client relationships (CRM), tracking daily tasks, visualizing organizational structures, and scheduling follow-ups.

## 🚀 Key Features

- **Client Management (CRM):** Maintain a detailed database of clients, manage follow-ups, and track call outcomes to prevent lost leads.
- **Task Management:** Create, track, and manage priority tasks with a clear view of overdue, pending, and completed items.
- **Team Visualization:** Dynamic, zoomable Organization Tree to easily manage and visualize your downline/team structure.
- **Calendar & Scheduling:** Integrated calendar view to manage upcoming client calls and deadlines.
- **Dashboard Overview:** Real-time metric cards for calls due, active tasks, and recent activity to keep you focused.
- **Data Privacy & Security:** Secure authentication and data isolation per user using Firebase.

## 🛠 Tech Stack

- **Frontend:** React 19, Vite, TypeScript
- **Styling:** Tailwind CSS
- **Routing:** React Router DOM
- **Backend/Database:** Firebase (Authentication, Firestore)
- **Icons:** FontAwesome

## 💻 Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn
- Firebase Project setup

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mananmaheshwari1702/Biztrack.git
   cd Biztrack
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Create a `.env` file in the root directory based on `.env.example` and add your Firebase configuration details:
   ```env
   VITE_FIREBASE_API_KEY=your_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
   VITE_FIREBASE_APP_ID=your_app_id
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:5173`.

### Building for Production

To create a production build:
```bash
npm run build
```

To preview the production build locally:
```bash
npm run preview
```

## 📂 Project Structure

- `src/components/`: Reusable UI components.
- `src/pages/`: Main application pages and views.
- `src/context/`: React context providers for global state management (Auth, Data).
- `src/hooks/`: Custom React hooks.
- `src/lib/`: Utility functions and Firebase configuration.
- `src/types/`: TypeScript type definitions.

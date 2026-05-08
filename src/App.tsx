import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './features/auth/context/AuthContext';
import { DataProvider } from './shared/context/DataContext';
import { ToastProvider } from './shared/context/ToastContext';
import ErrorBoundary from './shared/components/common/ErrorBoundary';
import ToastContainer from './shared/components/common/ToastContainer';
import PrivateRoute from './features/auth/components/PrivateRoute';
import Login from './features/auth/pages/Login';
import Dashboard from './features/dashboard/pages/Dashboard';
import NotFound from './pages/NotFound';
import Tasks from './features/tasks/pages/Tasks';
import Clients from './features/clients/pages/Clients';
import Calendar from './features/calendar/pages/Calendar';
import Team from './features/team/pages/Team';
import Profile from './features/profile/pages/Profile';

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <DataProvider>
<Router>
              <Routes>
                <Route path="/login" element={<Login />} />

                <Route element={<PrivateRoute />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/clients" element={<Clients />} />
                  <Route path="/team" element={<Team />} />
                  <Route path="/profile" element={<Profile />} />
                </Route>

                <Route path="*" element={<Navigate to="/404" replace />} />
                <Route path="/404" element={<NotFound />} />
              </Routes>
            </Router>
          </DataProvider>
          <ToastContainer />
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;

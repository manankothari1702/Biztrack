import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Layout from './layout/Layout';

const PrivateRoute: React.FC = () => {
    const { currentUser } = useAuth();

    return currentUser ? (
        <Layout>
            <Outlet />
        </Layout>
    ) : (
        <Navigate to="/login" replace />
    );
};

export default PrivateRoute;

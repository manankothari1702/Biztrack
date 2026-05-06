import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
    signUp, signIn, signOut, signInWithRedirect,
    resetPassword as amplifyResetPassword,
    updateUserAttributes, updatePassword,
    fetchAuthSession, getCurrentUser, fetchUserAttributes,
    type AuthUser,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import '../lib/aws'; // initialise Amplify config

// ── Types ───────────────────────────────────────────────────────────────────

interface AuthContextType {
    currentUser: AuthUser | null;
    loading: boolean;
    signup:              (email: string, password: string, name: string) => Promise<void>;
    login:               (email: string, password: string) => Promise<void>;
    googleSignIn:        () => Promise<void>;
    logout:              () => Promise<void>;
    resetPassword:       (email: string) => Promise<void>;
    updateName:          (name: string) => Promise<void>;
    updateEmailAddress:  (newEmail: string) => Promise<void>;
    updateUserPassword:  (oldPassword: string, newPassword: string) => Promise<void>;
    deleteAccount:       () => Promise<void>;
    getToken:            () => Promise<string>;
    getUserAttributes:   () => Promise<{ email?: string; name?: string; picture?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ── Provider ────────────────────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
    const [loading, setLoading]         = useState(true);

    const resolveUser = async () => {
        try {
            const user = await getCurrentUser();
            setCurrentUser(user);
        } catch {
            setCurrentUser(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        resolveUser();

        const unsubscribe = Hub.listen('auth', ({ payload }) => {
            if (['signedIn', 'signedOut', 'tokenRefresh'].includes(payload.event)) {
                resolveUser();
            }
        });

        return unsubscribe;
    }, []);

    // ── Auth actions ──────────────────────────────────────────────────────

    const handleSignup = async (email: string, password: string, name: string) => {
        await signUp({
            username: email,
            password,
            options: { userAttributes: { email, name } },
        });
    };

    const handleLogin = async (email: string, password: string) => {
        await signIn({ username: email, password });
        await resolveUser();
    };

    const handleGoogleSignIn = async () => {
        await signInWithRedirect({ provider: 'Google' });
    };

    const handleLogout = async () => {
        await signOut();
        setCurrentUser(null);
    };

    const handleResetPassword = async (email: string) => {
        await amplifyResetPassword({ username: email });
    };

    const handleUpdateName = async (name: string) => {
        await updateUserAttributes({ userAttributes: { name } });
    };

    const handleUpdateEmail = async (newEmail: string) => {
        await updateUserAttributes({ userAttributes: { email: newEmail } });
    };

    const handleUpdatePassword = async (oldPassword: string, newPassword: string) => {
        await updatePassword({ oldPassword, newPassword });
    };

    const handleDeleteAccount = async () => {
        const { userApi } = await import('../services/apiService');
        const profile = await userApi.getProfile();
        await userApi.updateProfile({ ...profile, deletionRequested: true } as never);
        await signOut();
    };

    const getUserAttributes = async (): Promise<{ email?: string; name?: string; picture?: string }> => {
        try {
            const attrs = await fetchUserAttributes();
            return { email: attrs.email, name: attrs.name, picture: attrs.picture };
        } catch {
            return {};
        }
    };

    const getToken = async (): Promise<string> => {
        const session = await fetchAuthSession();
        const token   = session.tokens?.idToken?.toString();
        if (!token) throw new Error('Not authenticated');
        return token;
    };

    return (
        <AuthContext.Provider value={{
            currentUser,
            loading,
            signup:             handleSignup,
            login:              handleLogin,
            googleSignIn:       handleGoogleSignIn,
            logout:             handleLogout,
            resetPassword:      handleResetPassword,
            updateName:         handleUpdateName,
            updateEmailAddress: handleUpdateEmail,
            updateUserPassword: handleUpdatePassword,
            deleteAccount:      handleDeleteAccount,
            getToken,
            getUserAttributes,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
};

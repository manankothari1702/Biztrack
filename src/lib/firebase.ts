import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { logger } from "../utils/logger";

// Firebase configuration loaded from environment variables
// Ensure all VITE_FIREBASE_* variables are set in your .env file
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Validate required configuration
const requiredEnvVars = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID'
];

const missingVars = requiredEnvVars.filter(
    varName => !import.meta.env[varName]
);

if (missingVars.length > 0) {
    logger.error(
        `Missing required Firebase environment variables: ${missingVars.join(', ')}. ` +
        'Please check your .env file.'
    );
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// App Check — prevents quota abuse by enforcing only your app can call Firebase.
// DEV:  A debug token is auto-generated and printed to the browser console on first run.
//       Copy it and add it in Firebase Console → App Check → Apps → Manage debug tokens.
// PROD: Requires VITE_RECAPTCHA_SITE_KEY (reCAPTCHA v3 site key).
//       Get one at https://www.google.com/recaptcha/admin/create → reCAPTCHA v3.
//       Then enable enforcement in Firebase Console → App Check → Apps.
if (import.meta.env.DEV) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN =
        import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
if (recaptchaSiteKey) {
    initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
    });
} else {
    logger.warn(
        'Firebase App Check is not active. ' +
        'Set VITE_RECAPTCHA_SITE_KEY in .env to protect against quota abuse.'
    );
}

export const auth = getAuth(app);
export const db = getFirestore(app);

// Connect to local emulators when VITE_USE_EMULATOR=true
// Analytics is disabled in emulator mode (it has no emulator and would fail)
if (import.meta.env.VITE_USE_EMULATOR === 'true') {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, 'localhost', 8080);
    logger.info('Connected to Firebase Emulators (Auth:9099, Firestore:8080)');
} else {
    // Analytics only in production — has no emulator equivalent
    getAnalytics(app);
}
